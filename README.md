# comitupis-sync

Prenos web porudžbina Pertini Toys u COMITUPIS (MS SQL u Pertini mreži, iz kog ih preuzima ERP preko IIB-a).

Skripta radi na računaru u Pertini mreži i pokreće je Task Scheduler na svakih 5–10 minuta. Jedno pokretanje:

1. pozove endpoint na sajtu (`ppc-prenos-endpoint.php?akcija=spremne`) i dobije neprenete porudžbine;
2. upiše svaku porudžbinu u `PPC_Dokument`, `PPC_DokIzlStav` i `PPC_DokPla`, u jednoj transakciji;
3. pošalje sajtu brojeve upisanih porudžbina (`akcija=potvrda`), a sajt ih označi kao prenete (`DatPrenComit`).

Endpoint je u repou `pertini-toys-shop-backoffice` (`public_html/ppc-prenos-endpoint.php`). Ceo opis toka, endpointa i odluka je u `ppcContext.md` istog repoa („Faza 2b“).

Ovo je Node.js verzija ranije PHP skripte (`comitupis-sync/` u backoffice repou) i radi isto. Razlike:

- config je u `.env`, a ne u `config.php`;
- MS SQL se otvara preko paketa `mssql` (tedious), pa ne trebaju ni PHP ekstenzije ni ODBC drajver;
- HTTPS radi bez `cacert.pem`, jer Node ima svoje CA sertifikate;
- greške SQL Servera koje sadrže vrednost iz reda („Truncated value: '…'“, „converting the nvarchar value '…'“) se u logu skraćuju, da podaci kupca ne bi završili u logu.

## Pokretanje

```bash
node sync.js                 # prenos (Task Scheduler)
node sync.js --proba         # samo povuče i ispiše porudžbine; ne otvara COMITUPIS i ništa ne potvrđuje
node obrisi-test.js          # pregled TEST- redova u COMITUPIS-u
node obrisi-test.js --da     # briše TEST- redove (prave porudžbine nikad ne dira)
```

Isto preko npm-a: `npm run sync`, `npm run proba`, `npm run obrisi-test`.

**Izlazni kod:** `0` sve u redu ili nema novih porudžbina; `1` greška (veza, upis ili potvrda); `2` greška u configu.

## Config (`.env`)

Kopirati `.env.example` u `.env` pored skripte i popuniti. `.env` nikad ne ide u git. Skripta ga čita iz svog foldera, bez obzira na radni folder. Promenljiva koja je već postavljena u okruženju ima prednost nad `.env`.

| Ključ | Šta je |
|---|---|
| `PPC_ENDPOINT` | `https://pertinitoys.com/ppc-prenos-endpoint.php`; lokalno `http://localhost:8080/ppc-prenos-endpoint.php` |
| `PPC_TOKEN` | isti kao u `public_html/ppc-prenos/config.php` na sajtu |
| `COMITUPIS_HOST`, `COMITUPIS_PORT` | `192.168.0.101`, `1433` |
| `COMITUPIS_INSTANCE` | prazno = podrazumevana instanca; ako je zadato, port se ne koristi |
| `COMITUPIS_DATABASE`, `COMITUPIS_USER`, `COMITUPIS_PASSWORD` | `ComitUPIS`, `comit`, lozinka |
| `COMITUPIS_ENCRYPT`, `COMITUPIS_TRUST_CERT` | `1` i `1`: šifrovana veza, a samopotpisan sertifikat servera se prihvata |
| `PREFIKS_BROJA` | prazno na produkciji; `TEST-` samo za test. Druge vrednosti su greška u configu |
| `MAX_KRUGOVA` | najviše poziva „spremne“ po jednom pokretanju (20) |

Vrednost sa razmacima ili znakom `#` ide pod navodnike: `COMITUPIS_PASSWORD="ab#c d"`.

## Kako radi

- **Zaključavanje:** ako prethodno pokretanje još radi, novo se preskače sa izlazom 0. Lock je named pipe (Windows) ili apstraktni socket (Linux). Sistem ga oslobađa čim proces završi ili padne, pa nema zaostalog lock fajla.
- Ako nema porudžbina, COMITUPIS se ne otvara. Pre konekcije se port proverava do 3 puta, jer je VPN nestabilan.
- **Svaka porudžbina ide u svojoj transakciji.** Ako bilo šta padne, ništa od te porudžbine nije upisano (rollback). Ostale porudžbine iz kruga se upisuju normalno.
- Pre upisa se proverava da li `Broj` već postoji u COMITUPIS-u. Ako postoji, potvrda se ranije izgubila, pa se porudžbina samo ponovo potvrđuje, bez dupliranja.
- Potvrda ide sa originalnim brojevima, bez prefiksa `TEST-`.
- Neuspela porudžbina ostaje nepotvrđena i pokušava se u sledećem pokretanju. Krug sa greškom prekida pokretanje.
- Ako endpoint vrati `ima_jos: true`, poziv se ponavlja do `MAX_KRUGOVA`.
- Upisuju se samo kolone iz šeme klijenta. Nepoznata kolona je greška. `null` se ne šalje, pa važi podrazumevana vrednost iz šeme.
- Sve vrednosti idu kao `nvarchar`, a server ih prevodi u tip i code page kolone. Datumi idu u formatu `Ymd H:i:s`, koji ne zavisi od jezika konekcije.
- Preusmerenja (HTTP 3xx) sa sajta se ne prate, da token ne bi otišao na drugu adresu.
- **Log:** svaki red ide na ekran i u `logs/sync-YYYY-MM.log` (vreme po `Europe/Belgrade`). U log idu samo brojevi porudžbina i iznosi, nikad podaci kupaca ni token.

## Lokalni test

Sajt i endpoint rade u Docker-u (`pertini-dev-web-1`), a skripta direktno na računaru, sa Node-om 22 ili novijim. Za upis u pravi COMITUPIS treba VPN preko hotspota (vidi „Mreža i VPN“ u `ppcContext.md`).

```bash
nc -vz 192.168.0.101 1433                  # mora da vrati "succeeded"
npm ci
cp .env.example .env                       # PPC_ENDPOINT=http://localhost:8080/ppc-prenos-endpoint.php,
                                           # lokalni token, lozinka, PREFIKS_BROJA=TEST-
node sync.js --proba
node sync.js
node obrisi-test.js                        # šta je upisano
node obrisi-test.js --da                   # brisanje posle testa
```

Za ponovni test porudžbine na lokalnom sajtu treba vratiti na neprenete:

```bash
docker exec pertini-dev-db-1 mysql -upertik -ppertik123 pertik_db1 -e "UPDATE PPC_Dokument SET DatPrenComit = NULL;"
```

## Instalacija kod Pertinija (Windows)

1. **Node.js 22 LTS ili noviji** (msi sa nodejs.org). Drugi drajveri ne trebaju.
2. Kopirati folder (npr. `C:\comitupis-sync\`) bez `.env`, `logs/` i `.git/`. Ako računar ima izlaz na npm, pokrenuti `npm ci`. Ako nema, kopirati i `node_modules/`: u njemu nema nativnih modula, pa radi i kad je napravljen na Linux-u.
3. Napraviti `.env` iz `.env.example`: produkcijski token, nova lozinka za `comit`, `PREFIKS_BROJA` prazno.
4. Prvo `node sync.js --proba`, pa `node sync.js`.
5. Task Scheduler, nov zadatak:
   - **Action:** program `C:\Program Files\nodejs\node.exe`, argument `C:\comitupis-sync\sync.js`;
   - **Trigger:** ponavljanje na 5 ili 10 minuta, bez kraja;
   - **General:** „Run whether user is logged on or not“;
   - **Settings:** „If the task is already running: Do not start a new instance“ i „Stop the task if it runs longer than 30 minutes“.

   Ako zadatak prekine skriptu usred upisa, SQL Server poništava započetu transakciju. Ako je prekine posle upisa, a pre potvrde, porudžbina se u sledećem pokretanju samo potvrdi.

## Zavisnosti

Jedina direktna zavisnost je `mssql` (zaključana verzija, ceo spisak je u `package-lock.json`). On uz `tedious` povlači i Microsoft-ove `@azure/*` pakete. Oni se koriste samo za Azure AD prijavu, a skripta se prijavljuje korisnikom i lozinkom, pa ne šalju ništa. Skripta se povezuje samo na `PPC_ENDPOINT` i COMITUPIS.
