# comitupis-sync

Program koji web porudžbine sa sajta `pertinitoys.com` prenosi u bazu `ComitUPIS`, odakle ih ERP preuzima preko IIB-a.

Uputstvo je namenjeno IT-u Pertini Toys: instalacija, svakodnevni rad i šta raditi kad nešto ne radi. Program je napisao i održava ga Comit.

## Kako radi

Program radi na jednom računaru u Pertini mreži. Task Scheduler ga pokreće na svakih 5–10 minuta. Svako pokretanje traje nekoliko sekundi:

1. Program se preko HTTPS-a javi sajtu i preuzme porudžbine koje još nisu prenete.
2. Svaku porudžbinu upiše u `ComitUPIS`, u tabele `PPC_Dokument`, `PPC_DokIzlStav` i `PPC_DokPla`.
3. Sajtu javi koje je porudžbine upisao, pa ih sajt više ne šalje.

```
pertinitoys.com  ◄── HTTPS (odlazni) ──  računar u Pertini mreži  ──► ComitUPIS (192.168.0.101)
```

- **Vezu uvek otvara ovaj računar.** Sa interneta se ništa ne otvara ka Pertini mreži i ne treba nikakav ulazni port, VPN ni javna adresa.
- Program je obična komandna linija: nema prozor, web server ni servis koji stalno radi.
- U `ComitUPIS` samo **upisuje** nove porudžbine. Ne briše i ne menja ništa što je ERP već preuzeo.
- Ako sajt ili `ComitUPIS` nisu dostupni, porudžbine čekaju na sajtu i prenose se u sledećem pokretanju. Ništa se ne gubi i ništa se ne upisuje dvaput.

## Šta je potrebno

| | |
|---|---|
| Računar | Windows (ili Linux) u Pertini mreži, uključen stalno, bar u radno vreme |
| Softver | **Node.js 22 LTS ili noviji**, sa [nodejs.org](https://nodejs.org). Drugi drajveri (ODBC i sl.) ne trebaju |
| Izlaz na internet | `https://pertinitoys.com` (port 443) |
| Pristup bazi | `192.168.0.101`, port `1433`, SQL korisnik `comit` (upis u tri PPC tabele) |
| Od Comit-a | folder sa programom i **token** za sajt |

Provera iz PowerShell-a, na tom računaru:

```powershell
node -v                                            # v22.x ili noviji
Test-NetConnection pertinitoys.com -Port 443       # TcpTestSucceeded : True
Test-NetConnection 192.168.0.101 -Port 1433        # TcpTestSucceeded : True
```

## Instalacija

**1. Node.js.** Instalirati LTS verziju (22 ili noviju) sa nodejs.org, sa podrazumevanim opcijama.

**2. Folder.** Program se kopira u `C:\comitupis-sync\`. Ako je folder dobijen bez `node_modules`, iz tog foldera pokrenuti:

```powershell
cd C:\comitupis-sync
npm ci
```

Ako računar nema izlaz na npm, Comit dostavlja folder zajedno sa `node_modules`, pa ovaj korak otpada.

**3. Podešavanje (`.env`).** Kopirati `.env.example` u `.env` u istom folderu i popuniti:

| Ključ | Vrednost |
|---|---|
| `PPC_ENDPOINT` | `https://pertinitoys.com/ppc-prenos-endpoint.php` (tačno ovako, bez ičega iza `.php`) |
| `PPC_TOKEN` | token koji dostavlja Comit |
| `COMITUPIS_HOST` | `192.168.0.101` |
| `COMITUPIS_PORT` | `1433` |
| `COMITUPIS_INSTANCE` | prazno (podrazumevana instanca) |
| `COMITUPIS_DATABASE` | `ComitUPIS` |
| `COMITUPIS_USER` | `comit` |
| `COMITUPIS_PASSWORD` | lozinka korisnika `comit` |
| `COMITUPIS_ENCRYPT`, `COMITUPIS_TRUST_CERT` | `1` i `1` (šifrovana veza; SQL Server ima samopotpisan sertifikat) |
| `PREFIKS_BROJA` | **prazno**. Koristi ga samo Comit za testiranje |
| `MAX_KRUGOVA` | `20` (ne menjati) |

Vrednost koja sadrži razmak ili `#` ide pod navodnike, npr. `COMITUPIS_PASSWORD="ab#c d"`.

`.env` sadrži token i lozinku. Pravo čitanja foldera treba da ima samo administrator i nalog pod kojim radi zakazani zadatak. Fajl se ne šalje mejlom i ne kopira na druge računare.

**4. Proba.** Iz foldera programa:

```powershell
cd C:\comitupis-sync
node sync.js --proba
```

Proba samo ispiše porudžbine koje čekaju na sajtu, ništa ne upisuje i ništa ne javlja sajtu. Očekivano je `krug 1: N porudžbina` sa spiskom brojeva, ili `nema novih porudžbina`.

**5. Prvi prenos**, kad Comit potvrdi da može:

```powershell
node sync.js
```

Na kraju piše `kraj: upisano N, već postojalo 0, grešaka 0`.

**6. Task Scheduler.** U Task Scheduler-u: „Create Task…“ (ne „Basic Task“).

| Kartica | Podešavanje |
|---|---|
| General | Ime `comitupis-sync`; „Run whether user is logged on or not“; nalog sa pravom čitanja `C:\comitupis-sync\` |
| Triggers | New → „On a schedule“, Daily, „Repeat task every: 5 minutes“ (ili 10), „for a duration of: Indefinitely“, Enabled |
| Actions | Start a program → Program: `C:\Program Files\nodejs\node.exe`, Arguments: `C:\comitupis-sync\sync.js` |
| Settings | „If the task is already running: Do not start a new instance“; „Stop the task if it runs longer than: 30 minutes“ |

Posle snimanja: desni klik na zadatak → „Run“, pa proveriti da „Last Run Result“ pokazuje `(0x0)` i da je u logu nov red (vidi ispod).

Program radi samo na **jednom** računaru. Ne instalirati ga na drugi računar paralelno.

## Svakodnevni rad

Ništa ne treba raditi: Task Scheduler pokreće program, a program sam nadoknađuje sve što je propušteno dok računar ili mreža nisu radili.

### Log

Svako pokretanje upisuje redove u `C:\comitupis-sync\logs\sync-GGGG-MM.log`, jedan fajl po mesecu. U logu su samo brojevi porudžbina i iznosi, nikad podaci kupaca. Poslednjih 50 redova:

```powershell
Get-Content C:\comitupis-sync\logs\sync-2026-11.log -Tail 50
```

Normalno pokretanje izgleda ovako:

```
2026-11-03 10:15:01 start
2026-11-03 10:15:01 krug 1: 2 porudžbina
2026-11-03 10:15:02   58123: upisana (3 stavki, 1 plaćanja)
2026-11-03 10:15:02   58124: upisana (1 stavki, 2 plaćanja)
2026-11-03 10:15:02 potvrđeno: 2, već potvrđeno: 0
2026-11-03 10:15:02 kraj: upisano 2, već postojalo 0, grešaka 0
```

ili, kad nema novih porudžbina:

```
2026-11-03 10:20:01 start
2026-11-03 10:20:01 nema novih porudžbina
2026-11-03 10:20:01 kraj: upisano 0, već postojalo 0, grešaka 0
```

Stari log fajlovi se mogu brisati po potrebi; program ih ne čita.

### Rezultat u Task Scheduler-u („Last Run Result“)

| Rezultat | Značenje |
|---|---|
| `(0x0)` | sve u redu, ili nije bilo novih porudžbina |
| `(0x1)` | greška: nema veze sa sajtom ili bazom, ili upis nije uspeo. Porudžbine čekaju i program ih pokušava u sledećem pokretanju. Razlog je u logu |
| `(0x2)` | greška u podešavanju (`.env`). Program ne radi dok se ne ispravi |

## Kad nešto ne radi

Prvo pogledati poslednje redove loga. Najčešće poruke:

| Poruka u logu | Uzrok | Šta raditi |
|---|---|---|
| `nema novih porudžbina` | sve je preneto | ništa |
| `prethodno pokretanje još radi, ovo se preskače` | prethodno pokretanje je trajalo duže od intervala | ništa, ako je povremeno |
| `dostignut MAX_KRUGOVA (20), ostatak u sledećem pokretanju` | posle dužeg prekida se skupilo mnogo porudžbina | ništa; ostatak ide u sledećim pokretanjima |
| `GREŠKA: endpoint spremne: nema veze (…)` | računar nema internet ili sajt ne radi | proveriti `Test-NetConnection pertinitoys.com -Port 443`; ako internet radi, javiti Comit-u |
| `GREŠKA: endpoint spremne: HTTP 403, zabranjeno` | token u `.env` ne odgovara tokenu na sajtu | javiti Comit-u |
| `GREŠKA: COMITUPIS: 192.168.0.101:1433 nije dostupan (…)` | SQL Server ne radi, ili ga firewall ili mreža blokiraju | proveriti SQL Server i `Test-NetConnection 192.168.0.101 -Port 1433` |
| `GREŠKA: COMITUPIS: Login failed for user 'comit'` | lozinka u `.env` ne odgovara lozinki u SQL Server-u | ispraviti `COMITUPIS_PASSWORD` u `.env` |
| `58123: GREŠKA … (ništa nije upisano)` | jedna porudžbina nije prošla upis (npr. kolona ili ključ u bazi) | poslati Comit-u te redove iz loga; porudžbina čeka i ništa od nje nije upisano |
| `GREŠKA: nema .env…` ili `GREŠKA: .env: …` | `.env` ne postoji ili nešto nije popunjeno | ispraviti `.env` (vidi „Instalacija“, korak 3) |
| `potvrđeno: …, nepoznato na sajtu: …` | sajt ne prepoznaje broj porudžbine | poslati Comit-u te redove iz loga |

Program se može pokrenuti i ručno, iz PowerShell-a, da se greška vidi odmah na ekranu:

```powershell
cd C:\comitupis-sync
node sync.js --proba     # samo prikaz, ništa ne upisuje
node sync.js             # prenos, isto kao Task Scheduler
```

Ručno pokretanje je bezbedno i dok radi zakazani zadatak: drugo pokretanje se samo preskoči.

## Izmene

- **Promena lozinke `comit`:** prvo promeniti lozinku u SQL Server-u, pa `COMITUPIS_PASSWORD` u `.env`. Restart ne treba, jer se `.env` čita pri svakom pokretanju. Između te dve izmene pokretanja javljaju grešku, a porudžbine čekaju.
- **Nov token:** dostavlja ga Comit; menja se samo `PPC_TOKEN` u `.env`.
- **Prelazak na drugi računar:** isključiti zadatak na starom računaru, pa ponoviti instalaciju na novom. Folder `logs` se može preneti, a ne mora.
- **Interval:** menja se samo u Task Scheduler-u (Triggers).

## Ne raditi

- Ne menjati `PREFIKS_BROJA` i ne pokretati `obrisi-test.js`. To su alati Comit-a za testiranje.
- Ne brisati i ne menjati ručno redove u PPC tabelama `ComitUPIS`-a koje ERP još nije preuzeo.
- Ne pokretati program sa dva računara istovremeno.
- Ne slati `.env`, token ili lozinku mejlom ili porukom.

## Tehnički detalji

- Program je Node.js skripta (`sync.js`, `lib.js`). Jedina direktna zavisnost je npm paket `mssql` (verzija zaključana u `package-lock.json`). On sa sobom povlači Microsoft-ove `@azure/*` pakete, koji služe samo za Azure AD prijavu; program se prijavljuje SQL korisnikom i lozinkom, pa ti paketi ne šalju ništa.
- Program se povezuje **samo** na `PPC_ENDPOINT` (sajt) i `ComitUPIS`. Preusmerenja sa sajta ne prati, da token ne bi otišao na drugu adresu.
- Svaka porudžbina se upisuje u jednoj transakciji: upisano je sve (zaglavlje, stavke, plaćanja) ili ništa. Ako se zadatak prekine usred upisa, SQL Server poništava započetu porudžbinu.
- Pre upisa program proverava da li porudžbina već postoji u `ComitUPIS`-u. Ako postoji, ne upisuje je ponovo, nego samo javlja sajtu.
- `SttPren` je pri upisu `'U'`. ERP ga menja kad preuzme porudžbinu, a program ga nikad ne dira.
- Izlazni kod: `0` u redu, `1` greška u radu, `2` greška u podešavanju.
