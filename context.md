# comitupis-sync — kontekst za nas (Comit)

Interni opis skripte: šta radi, kako se testira, kako se pušta i gde su zamke. Za Pertini je `README.md`. Ceo posao (PPC tabele, cene, endpoint, odluke sa ERP stranom) opisan je u `ppcContext.md` u repou `pertini-toys-shop-backoffice`, odeljak „Faza 2b“. Ovaj fajl pokriva samo skriptu.

## Šta je i gde je

Node.js CLI (bez ekrana i web servera) koji prenosi web porudžbine sa sajta u MS SQL bazu `COMITUPIS` u Pertini mreži, odakle ih ERP preuzima preko IIB-a.

```
kupac poruči ──► checkout-finished.php ──► PPC tabele (naša MariaDB, odmah)
                                                 ▲
                         HTTPS + X-Ppc-Token     │ 1. „spremne“  3. „potvrda“
                                                 │
                     comitupis-sync (računar u Pertini mreži) ──2. upis──► COMITUPIS ──► IIB / ERP
```

- **Vezu uvek otvara skripta**, iz Pertinija ka sajtu. Sajt nikad ne ulazi u Pertini mrežu, a kod Pertinija se ništa ne otvara ka internetu.
- Skripta nikad ne pristupa našoj bazi direktno, samo preko endpointa `public_html/ppc-prenos-endpoint.php` (repo `pertini-toys-shop-backoffice`).
- Repo: GitHub `Pertini-Toys/comitupis-sync` (privatan), grana `main`. Lokalno `~/Projects/comitupis-sync`.
- Zamenila je PHP verziju (`comitupis-sync/` u backoffice repou), koja se ne pušta i briše se. Razlog: na Windows-u PHP traži `pdo_sqlsrv`, ODBC drajver i `cacert.pem`, a Node samo instalaciju Node-a.

## Stanje (26. 10. 2026)

| Deo | Stanje |
|---|---|
| Upis u PPC tabele pri porudžbini | ✅ produkcija od 23. 10. |
| Migracija `add-ppc-prenos.sql` (kolona `DatPrenComit`) | ✅ produkcija 26. 10. |
| Endpoint + `ppc-prenos/.htaccess` + produkcijski `config.php` (nov token) | ✅ produkcija 26. 10.; `config.php` vraća 403, endpoint bez tokena „zabranjeno“ |
| Skripta | ✅ testirana sa lokala preko VPN-a; **26. 10. pokrenuta sa lokala na produkcijski endpoint**, vidi „Incident 26. 10.“ |
| Instalacija kod Pertinija | ⏳ čeka računar od Nikole |
| Lozinka `comit` | ⏳ treba je promeniti: bila je u git-u backoffice repoa i u `main` |
| Odgovori ERP-a (SifOJ, NacPla, PDV, dostava, AdrParIsp, varijanta cena) i `od_datuma` | ⏳ |

## Fajlovi

| Fajl | Šta je | Git |
|---|---|---|
| `sync.js` | glavna skripta: povuče, upiše, potvrdi | da |
| `lib.js` | config, log, zaključavanje, `http()` ka endpointu, `mssql()` konekcija, `upisiPorudzbinu()` | da |
| `obrisi-test.js` | briše **samo** redove čiji `Broj` počinje sa `TEST-`; bez `--da` samo ispiše | da |
| `package.json`, `package-lock.json` | jedina zavisnost `mssql` 12.7.2, zaključano celo stablo | da |
| `.env.example` | primer configa bez tajni | da |
| `README.md` | uputstvo za Pertini | da |
| `context.md` | ovaj fajl | da |
| `.env` | pravi config (token, lozinka) | **ne** |
| `logs/` | `sync-YYYY-MM.log` | **ne** |
| `node_modules/` | `npm ci` | **ne** |

## Config (`.env`)

Čita se iz foldera skripte (ne iz radnog foldera, jer ga Task Scheduler postavlja na `System32`), pri svakom pokretanju, pa posle izmene ne treba restart. Promenljiva iz okruženja ima prednost nad `.env`. Vrednost sa razmacima ili `#` ide pod navodnike.

| Ključ | Lokalni test (naš računar) | Produkcija (računar kod Pertinija) |
|---|---|---|
| `PPC_ENDPOINT` | `http://localhost:8080/ppc-prenos-endpoint.php` | `https://pertinitoys.com/ppc-prenos-endpoint.php` |
| `PPC_TOKEN` | lokalni token iz `public_html/ppc-prenos/config.php` | produkcijski token (samo u produkcijskom `config.php` i ovde) |
| `COMITUPIS_HOST` / `_PORT` / `_INSTANCE` | `192.168.0.101` / `1433` / prazno | isto |
| `COMITUPIS_DATABASE` / `_USER` / `_PASSWORD` | `ComitUPIS` / `comit` / lozinka | isto |
| `COMITUPIS_ENCRYPT` / `_TRUST_CERT` | `1` / `1` | isto (server ima samopotpisan sertifikat) |
| `PREFIKS_BROJA` | `TEST-` | **prazno** |
| `MAX_KRUGOVA` | 20 (podrazumevano) | 20 |

U `PPC_ENDPOINT` ide samo adresa do `.php`. `?akcija=spremne` i `?akcija=potvrda` skripta dodaje sama (`lib.js`, `http()`), a token šalje u headeru `X-Ppc-Token`.

**Pravilo:** `TEST-` ide **samo** uz `localhost`. Produkcijski endpoint ide **samo** sa praznim prefiksom. Razlog je u „Incident 26. 10.“.

## Kako radi

Jedno pokretanje se sastoji od krugova. Jedan krug:

1. `GET ?akcija=spremne`: endpoint vraća najviše `limit` neprenetih porudžbina (produkcija: 50), najstarije prve, i `ima_jos`.
2. Za svaku porudžbinu: provera da li `Broj` već postoji u COMITUPIS-u. Ako postoji, potvrda se ranije izgubila, pa se samo ponovo potvrđuje. Ako ne postoji, upis zaglavlja, stavki i plaćanja u **jednoj transakciji**.
3. `POST ?akcija=potvrda` sa brojevima upisanih porudžbina, **bez** `TEST-` prefiksa. Sajt postavlja `DatPrenComit`.
4. Ako je `ima_jos: true`, sledi novi krug, do `MAX_KRUGOVA`. Po pokretanju je to najviše `MAX_KRUGOVA × limit` = 1000; ostatak ide u sledećem pokretanju.

Ostalo:

- **Zaključavanje:** named pipe (Windows) ili apstraktni socket (Linux), ime iz putanje foldera. Drugo pokretanje dok prvo radi završava sa izlazom 0. Nema lock fajla koji bi ostao posle pada.
- COMITUPIS se otvara tek kad ima šta da se upiše. Port se pre toga proverava do 3 puta (5 s timeout, 2 s pauza).
- Porudžbina koja padne nije potvrđena i ponovo se pokušava u sledećem pokretanju. Krug sa greškom prekida pokretanje (izlaz 1), da se ista porudžbina ne bi vrtela u petlji.
- Upisuju se samo kolone iz šeme klijenta (`KOLONE` u `lib.js`, isto kao `$PPC_KOLONE` u endpointu). Nepoznata kolona je greška. `null` se ne šalje, pa važi podrazumevana vrednost iz šeme.
- Sve vrednosti idu kao `nvarchar`, a server ih prevodi u tip i code page kolone. Datumi idu kao `Ymd H:i:s`, što ne zavisi od jezika konekcije.
- HTTP preusmerenja se ne prate (`redirect: 'manual'`), da token ne bi otišao na drugu adresu. Produkcija nema preusmerenje sa `pertinitoys.com` i nije iza Cloudflare-a (provereno 26. 10.).
- **Log:** ekran i `logs/sync-YYYY-MM.log`, vreme po `Europe/Belgrade`. Samo brojevi porudžbina i iznosi; nikad podaci kupaca ni token. `poruka()` iz SQL grešaka odseca vrednost reda („Truncated value“, „converting the nvarchar value“).
- **Izlazni kod:** `0` ok ili nema novih; `1` greška (veza, upis, potvrda); `2` config.

Ako ERP strana doda kolone (npr. status), menja se `KOLONE` u `lib.js` i `$PPC_KOLONE` u endpointu.

## Lokalni test

Sajt i endpoint rade u Docker-u (`pertini-dev-web-1`), a skripta direktno na računaru (Node 22+). Za upis u pravi COMITUPIS treba VPN preko hotspota: Pertini LAN je `192.168.0.0/24`, isto kao većina kućnih mreža. Detalji su u „Mreža i VPN“ u `ppcContext.md`.

```bash
nc -vz 192.168.0.101 1433          # mora "succeeded"; VPN je nestabilan, ponoviti
cd ~/Projects/comitupis-sync
grep -E '^(PPC_ENDPOINT|PREFIKS_BROJA)=' .env   # PRE SVEGA: localhost + TEST-
node sync.js --proba               # šta bi se prenelo; ništa ne upisuje ni ne potvrđuje
node sync.js                       # prenos
node obrisi-test.js                # šta je od TEST- u COMITUPIS-u
node obrisi-test.js --da           # brisanje TEST- redova (IIB ih ne sme preuzeti)
```

Ponovni test istih porudžbina zahteva da se lokalno vrate na neprenete:

```bash
docker exec pertini-dev-db-1 mysql -upertik -ppertik123 pertik_db1 -e "UPDATE PPC_Dokument SET DatPrenComit = NULL;"
```

Posle izmene fajla u `public_html/` treba `docker restart pertini-dev-web-1`, inače kontejner čita staru verziju. Za skriptu ovo ne važi.

## Incident 26. 10. 2026: produkcijske porudžbine označene kao prenete

Lokalni `.env` je imao `PPC_ENDPOINT=https://pertinitoys.com/...`, produkcijski token i `PREFIKS_BROJA=TEST-`. Pokretanje u 11:36 je:

1. povuklo **14 pravih porudžbina sa produkcije** (`58071`–`58084`, od 25. 10. 00:15 do 26. 10. 09:15);
2. upisalo ih u COMITUPIS kao `TEST-58071` … `TEST-58084`;
3. potvrdilo produkciji **originalne brojeve**, pa je na sajtu postavljen `DatPrenComit`;
4. zatim je `obrisi-test.js --da` (11:37) obrisao `TEST-` redove iz COMITUPIS-a.

Posledica: na produkciji su tih 14 porudžbina označene kao prenete, a u COMITUPIS-u ih nema. Endpoint ih više nikad ne bi vratio. Ispravka na produkcijskoj bazi:

```sql
UPDATE PPC_Dokument
SET DatPrenComit = NULL
WHERE Broj IN ('58071','58072','58073','58074','58075','58076','58077','58078','58079','58080','58081','58082','58083','58084')
  AND DatPrenComit >= '2026-10-26 11:36:00';
```

Iz istog loga se vidi i da je produkcijski `od_datuma` 25. 10. 2026 ili raniji, a ne u budućnosti.

**Pouka:** kombinacija produkcijski endpoint + `TEST-` je uvek pogrešna. Lokalni `.env` uvek pokazuje na `localhost`, a produkcijski `.env` postoji samo na računaru kod Pertinija.

## Puštanje kod Pertinija (Windows)

Korak po korak je u `README.md` („Instalacija“). Ukratko:

1. Node.js 22 LTS ili noviji.
2. Folder `C:\comitupis-sync\`, bez `.env`, `logs/` i `.git/`. `npm ci`, ili kopiran `node_modules/` (nema nativnih modula, pa radi i ako je napravljen na Linux-u).
3. `.env` iz `.env.example`: produkcijski token, (nova) lozinka `comit`, `PREFIKS_BROJA` prazno.
4. `node sync.js --proba`, pa `node sync.js`.
5. Task Scheduler na 5 ili 10 minuta, sa „Do not start a new instance“ i „Stop the task if it runs longer than 30 minutes“.

Pre prvog pravog prenosa: dogovoren `od_datuma` u produkcijskom `config.php`, promenjena lozinka `comit`, potvrda ERP-a da IIB sme da preuzima.

**Token** zna samo osoba koja instalira. Ako ga Nikola instalira sam, token mu se predaje preko password managera ili usmeno, nikad mejlom ili porukom. Kad se sumnja da je procureo: nov token u produkcijskom `config.php` i u `.env` kod Pertinija.

Na Linux računaru: Node 22+ sa nodejs.org (paket iz distribucije je često stariji), cron sa punim putanjama (`*/5 * * * * /opt/node/bin/node /opt/comitupis-sync/sync.js >/dev/null 2>&1`), poseban korisnik, `chmod 600 .env`.

## Poznata ograničenja

- **Ćirilica u `AdrParIsp`** postaje `?` u COMITUPIS-u (`varchar`, CP1250). Zasad se ne rešava. Rešenja: ERP strana prebaci kolonu u `nvarchar`, ili `insert()` u `lib.js` preslovljava ćirilicu u latinicu.
- Status i otkazivanje se ne prenose, jer ih šema nema.
- Na pravoj bazi nisu ponovljeni rollback usred porudžbine i granična porudžbina (ćirilica, 250 znakova, BV sa kvačicama). Prošli su sa PHP verzijom i sa lažnom bazom.
- Na Windows-u još nisu provereni named pipe lock, HTTPS ka produkciji i Task Scheduler; to se proverava pri instalaciji.
