// Zajedničke funkcije skripte za prenos porudžbina u COMITUPIS (sync.js, obrisi-test.js).
// Skripta radi na računaru u Pertini mreži; opis: context.md i ppcContext.md („Faza 2b“) u backoffice repou.
import { appendFileSync, existsSync, mkdirSync, writeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import sql from 'mssql';

const FOLDER = import.meta.dirname;

export const TABELE = ['PPC_Dokument', 'PPC_DokIzlStav', 'PPC_DokPla'];

// Kolone koje skripta sme da upiše; iste kao u ppc-prenos-endpoint.php (šema klijenta bez TimeStamp i DatNalDok)
const KOLONE = {
	PPC_Dokument: ['Broj', 'Tip', 'SifRC', 'SifPar', 'SifParIsp', 'SifOJ', 'DatDok', 'NacPla', 'DatDos', 'IznNto', 'IznBrt', 'BrUsl', 'BrCen', 'PrcPop', 'NacOtp', 'PozBr', 'PozBr2', 'AdrParIsp', 'Napomena', 'SttPren', 'DatPren'],
	PPC_DokIzlStav: ['Broj', 'SifArt', 'IzlKol', 'CenBrtPrd', 'CenNtoPrd', 'PrcRab', 'PrcRabSti', 'PrcRabProm', 'IznBrt', 'IznRab', 'IznPop', 'IznNto', 'SerBr', 'Opis', 'BrojOtp', 'SttPrzFT'],
	PPC_DokPla: ['Broj', 'Rbr', 'NacPla', 'IznPla', 'SerBr'],
};

// datetime / smalldatetime kolone: endpoint šalje 'Y-m-d H:i:s', a MS SQL dobija 'Ymd H:i:s', koji ne zavisi od jezika konekcije
const DATUMI = ['DatDok', 'DatDos', 'DatPren'];

// prefiks test porudžbina; obrisi-test.js briše samo redove sa njim
export const TEST_PREFIKS = 'TEST-';

// ista zona kao shop (require.php); koristi se za vreme u logu i ime mesečnog log fajla
const VREME = new Intl.DateTimeFormat('en-GB', {
	timeZone: 'Europe/Belgrade', hourCycle: 'h23',
	year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

// neočekivana greška (npr. neispravan odgovor endpointa) se loguje kao i ostale, sa izlazom 1
process.on('uncaughtException', e => kraj(poruka(e)));
process.on('unhandledRejection', e => kraj(poruka(e)));

// Config iz .env pored skripte (ne iz radnog foldera, jer ga Task Scheduler postavlja na System32).
// Promenljive koje već postoje u okruženju imaju prednost nad .env.
export function config() {
	const fajl = path.join(FOLDER, '.env');
	if (!existsSync(fajl)) {
		kraj('nema .env; kopirati .env.example i popuniti', 2);
	}
	try {
		process.loadEnvFile(fajl);
	} catch (e) {
		kraj(`.env: ${e.message}`, 2);
	}
	const env = kljuc => process.env[kljuc] ?? '';
	for (const kljuc of ['PPC_ENDPOINT', 'PPC_TOKEN', 'COMITUPIS_HOST', 'COMITUPIS_DATABASE', 'COMITUPIS_USER', 'COMITUPIS_PASSWORD']) {
		if (env(kljuc).trim() === '') {
			kraj(`.env: nije popunjeno '${kljuc}'`, 2);
		}
	}
	const prefiks = env('PREFIKS_BROJA');
	if (prefiks !== '' && prefiks !== TEST_PREFIKS) {
		kraj(`.env: PREFIKS_BROJA sme da bude samo prazno ili '${TEST_PREFIKS}'`, 2);
	}
	return {
		endpoint: env('PPC_ENDPOINT'),
		token: env('PPC_TOKEN'),
		mssql: {
			host: env('COMITUPIS_HOST'),
			port: env('COMITUPIS_PORT') === '' ? 1433 : Number(env('COMITUPIS_PORT')),
			instance: env('COMITUPIS_INSTANCE'),
			database: env('COMITUPIS_DATABASE'),
			user: env('COMITUPIS_USER'),
			password: env('COMITUPIS_PASSWORD'),
			encrypt: env('COMITUPIS_ENCRYPT') !== '0',
			trustServerCertificate: env('COMITUPIS_TRUST_CERT') !== '0',
		},
		prefiksBroja: prefiks,
		maxKrugova: env('MAX_KRUGOVA') === '' ? 20 : Math.max(1, parseInt(env('MAX_KRUGOVA'), 10) || 0),
	};
}

// Folder za log; pravi se pri prvom pokretanju
function logFolder() {
	const folder = path.join(FOLDER, 'logs');
	try {
		mkdirSync(folder, { recursive: true });
	} catch {}
	return folder;
}

function sada() {
	const d = Object.fromEntries(VREME.formatToParts(new Date()).map(deo => [deo.type, deo.value]));
	return `${d.year}-${d.month}-${d.day} ${d.hour}:${d.minute}:${d.second}`;
}

// Ispis na ekran. Sinhrono, da se ništa ne izgubi kad odmah posle ide process.exit.
export function ispis(red) {
	try {
		writeSync(1, red + '\n');
	} catch {}
}

// Ispis i mesečni log (logs/sync-YYYY-MM.log). U log idu samo brojevi i iznosi, nikad podaci kupaca ni token.
export function log(poruka) {
	const vreme = sada();
	const red = `${vreme} ${poruka}`;
	ispis(red);
	try {
		appendFileSync(path.join(logFolder(), `sync-${vreme.slice(0, 7)}.log`), red + '\n');
	} catch {}
}

// Poruka greške za log. SQL Server u nekim porukama navodi vrednost koja nije prošla
// („Truncated value: '…'“, „converting the nvarchar value '…'“), a to mogu biti podaci kupca (AdrParIsp, Napomena),
// pa se vrednost odseca.
export function poruka(e) {
	return String(e?.message ?? e)
		.replace(/(Truncated value: )[\s\S]*$/i, '$1…')
		.replace(/(converting the n?varchar value )'[\s\S]*?(' to data type)/i, "$1'…$2")
		.trim();
}

export function kraj(poruka, kod = 1) {
	log('GREŠKA: ' + poruka);
	process.exit(kod);
}

// Samo jedno pokretanje u isto vreme (Task Scheduler može da pokrene novo dok prethodno još radi).
// Zaključava se named pipe-om (Windows) ili apstraktnim socketom (Linux): sistem ga oslobađa čim proces
// završi ili padne, kao flock u PHP verziji, pa nema zaostalog lock fajla. Ime zavisi od foldera skripte.
// Vraća false kad prethodno pokretanje još radi.
export function zakljucaj() {
	const ime = 'comitupis-sync-' + createHash('sha1').update(FOLDER).digest('hex').slice(0, 12);
	const adresa = process.platform === 'win32' ? `\\\\.\\pipe\\${ime}` : `\0${ime}`;
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.once('error', e => (e.code === 'EADDRINUSE' ? resolve(false) : reject(new Error(`zaključavanje: ${e.message}`))));
		server.listen(adresa, () => {
			server.unref();
			resolve(true);
		});
	});
}

// Poziv endpointa na sajtu. Vraća dekodiran JSON; baca grešku kad nema veze ili odgovor nije {"ok":true}.
// Preusmerenja se ne prate (kao curl bez FOLLOWLOCATION), da token ne ode na drugu adresu.
export async function http(config, akcija, telo = null) {
	const opcije = {
		headers: { 'X-Ppc-Token': config.token, Accept: 'application/json' },
		redirect: 'manual',
		signal: AbortSignal.timeout(60000),
	};
	if (telo !== null) {
		opcije.method = 'POST';
		opcije.headers['Content-Type'] = 'application/json';
		opcije.body = JSON.stringify(telo);
	}

	let kod, odgovor;
	try {
		const res = await fetch(`${config.endpoint}?akcija=${akcija}`, opcije);
		kod = res.status;
		odgovor = await res.text();
	} catch (e) {
		throw new Error(`endpoint ${akcija}: nema veze (${e.cause?.message ?? e.message})`);
	}

	let json = null;
	try {
		json = JSON.parse(odgovor);
	} catch {}
	if (kod !== 200 || json === null || typeof json !== 'object' || !json.ok) {
		const greska = json?.greska ?? odgovor.replace(/<[^>]*>/g, '').trim().slice(0, 200);
		throw new Error(`endpoint ${akcija}: HTTP ${kod}, ${greska}`);
	}
	return json;
}

// Provera porta; vraća null kad je dostupan, inače opis greške
function proveriPort(host, port, ms) {
	return new Promise(resolve => {
		const soket = net.connect({ host, port });
		soket.setTimeout(ms, () => {
			soket.destroy();
			resolve('timeout');
		});
		soket.once('connect', () => {
			soket.destroy();
			resolve(null);
		});
		soket.once('error', e => resolve(e.message));
	});
}

// Konekcija ka COMITUPIS (tedious, bez ODBC-a i drajvera). Baca grešku kad veza ne uspe.
export async function mssql(m) {
	// preko VPN-a veza ponekad ne prolazi, pa se port proverava pre logovanja, do 3 puta
	if (m.instance === '') {
		for (let pokusaj = 1; ; pokusaj++) {
			const greska = await proveriPort(m.host, m.port, 5000);
			if (greska === null) {
				break;
			}
			if (pokusaj === 3) {
				throw new Error(`${m.host}:${m.port} nije dostupan (${greska})`);
			}
			await new Promise(r => setTimeout(r, 2000));
		}
	}

	const pool = new sql.ConnectionPool({
		server: m.host,
		...(m.instance === '' ? { port: m.port } : {}),
		database: m.database,
		user: m.user,
		password: m.password,
		connectionTimeout: 15000,
		requestTimeout: 60000,
		pool: { min: 0, max: 1 },
		options: {
			encrypt: m.encrypt,
			trustServerCertificate: m.trustServerCertificate, // server ima samopotpisan sertifikat
			...(m.instance === '' ? {} : { instanceName: m.instance }),
		},
	});
	await pool.connect();
	return pool;
}

// Upis jedne porudžbine iz endpointa u sve tri tabele, u jednoj transakciji.
// Vraća 'upisana' ili 'postoji' (već je u COMITUPIS: prošla potvrda se izgubila, pa se samo ponovo potvrđuje).
// Baca grešku kad upis ne uspe; tada se ništa ne upisuje (rollback).
export async function upisiPorudzbinu(pool, porudzbina, prefiks) {
	if (porudzbina?.dokument?.Broj == null || !Array.isArray(porudzbina.stavke) || !Array.isArray(porudzbina.placanja)) {
		throw new Error('neispravan oblik porudžbine iz endpointa');
	}
	const broj = prefiks + porudzbina.dokument.Broj;

	const upit = await pool.request()
		.input('broj', sql.NVarChar, broj)
		.query('SELECT COUNT(*) AS n FROM PPC_Dokument WHERE Broj = @broj');
	if (upit.recordset[0].n > 0) {
		return 'postoji';
	}

	const transakcija = new sql.Transaction(pool);
	await transakcija.begin();
	try {
		await insert(transakcija, 'PPC_Dokument', porudzbina.dokument, broj);
		for (const stavka of porudzbina.stavke) {
			await insert(transakcija, 'PPC_DokIzlStav', stavka, broj);
		}
		for (const placanje of porudzbina.placanja) {
			await insert(transakcija, 'PPC_DokPla', placanje, broj);
		}
		await transakcija.commit();
	} catch (e) {
		// kod nekih grešaka SQL Server sam poništi transakciju, pa rollback ovde javlja da je nema
		try {
			await transakcija.rollback();
		} catch {}
		throw e;
	}
	return 'upisana';
}

// INSERT jednog reda. Kolone van KOLONE su greška; null se ne šalje, pa važi podrazumevana vrednost iz šeme.
// Sve vrednosti idu kao nvarchar (kao N'…' u PHP verziji), pa ih server sam prevodi u tip i code page kolone.
async function insert(transakcija, tabela, red, broj) {
	const vrednosti = {};
	for (const [kolona, vrednost] of Object.entries({ ...red, Broj: broj })) {
		if (!KOLONE[tabela].includes(kolona)) {
			throw new Error(`nepoznata kolona ${tabela}.${kolona}`);
		}
		if (vrednost === null) {
			continue;
		}
		vrednosti[kolona] = DATUMI.includes(kolona) ? datum(tabela, kolona, String(vrednost)) : String(vrednost);
	}

	const kolone = Object.keys(vrednosti);
	const zahtev = new sql.Request(transakcija);
	kolone.forEach((kolona, i) => zahtev.input(`p${i}`, sql.NVarChar, vrednosti[kolona]));
	await zahtev.query(`INSERT INTO ${tabela} (${kolone.join(', ')}) VALUES (${kolone.map((_, i) => `@p${i}`).join(', ')})`);
}

// 'Y-m-d H:i:s' → 'Ymd H:i:s'; nepostojeći datum (npr. 2026-02-30) je greška
function datum(tabela, kolona, vrednost) {
	const d = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(vrednost);
	const provera = d && new Date(Date.UTC(+d[1], d[2] - 1, +d[3], +d[4], +d[5], +d[6]));
	if (!d || provera.getUTCMonth() !== d[2] - 1 || provera.getUTCDate() !== +d[3] || provera.getUTCHours() !== +d[4]
		|| provera.getUTCMinutes() !== +d[5] || provera.getUTCSeconds() !== +d[6]) {
		throw new Error(`neispravan datum ${tabela}.${kolona}: ${vrednost}`);
	}
	return `${d[1]}${d[2]}${d[3]} ${d[4]}:${d[5]}:${d[6]}`;
}
