// Prenos web porudžbina u COMITUPIS. Radi na računaru u Pertini mreži, a pokreće ga Task Scheduler (Windows)
// ili cron (Linux) na ~5 minuta. Jedan krug: povuče porudžbine sa sajta (ppc-prenos-endpoint.php, „spremne“),
// upiše svaku u COMITUPIS u jednoj transakciji, pa sajtu potvrdi upisane brojeve („potvrda“). Opis: README.md.
//   node sync.js           prenos
//   node sync.js --proba   samo povuče i ispiše porudžbine; ne otvara COMITUPIS i ništa ne potvrđuje
// Izlazni kod: 0 sve u redu (ili nema novih), 1 greška (veza, upis ili potvrda), 2 config.
import { config, http, kraj, log, mssql, poruka, upisiPorudzbinu, zakljucaj } from './lib.js';

const proba   = process.argv.includes('--proba');
const cfg     = config();
const prefiks = cfg.prefiksBroja;
const krugova = cfg.maxKrugova;

// samo jedno pokretanje u isto vreme (Task Scheduler može da pokrene novo dok prethodno još radi)
if (!(await zakljucaj())) {
	log('prethodno pokretanje još radi, ovo se preskače');
	process.exit(0);
}

log('start' + (proba ? ' (proba)' : '') + (prefiks !== '' ? `, test prefiks '${prefiks}'` : ''));

let pool     = null; // COMITUPIS se otvara tek kad ima šta da se upiše
const ukupno = { upisana: 0, postoji: 0, greska: 0 };
let izlaz    = 0;

for (let krug = 1; krug <= krugova; krug++) {
	let odgovor;
	try {
		odgovor = await http(cfg, 'spremne');
	} catch (e) {
		kraj(poruka(e));
	}
	const porudzbine = odgovor.porudzbine ?? [];
	if (!porudzbine.length) {
		if (krug === 1) {
			log('nema novih porudžbina');
		}
		break;
	}
	log(`krug ${krug}: ${porudzbine.length} porudžbina` + (odgovor.ima_jos ? ', na sajtu ima još' : ''));

	if (proba) {
		for (const p of porudzbine) {
			const d        = p.dokument ?? {};
			const placanja = (p.placanja ?? []).map(pl => `${String(pl.NacPla ?? '').trim()} ${pl.IznPla ?? ''}`);
			log(`  ${prefiks}${d.Broj}: DatPren ${d.DatPren ?? ''}, IznBrt ${d.IznBrt ?? ''}, IznNto ${d.IznNto ?? ''}, `
				+ `${(p.stavke ?? []).length} stavki, plaćanja: ${placanja.join('; ')}`);
		}
		log('proba: ništa nije upisano ni potvrđeno');
		break;
	}

	if (!pool) {
		try {
			pool = await mssql(cfg.mssql);
		} catch (e) {
			kraj('COMITUPIS: ' + poruka(e) + ' (porudžbine čekaju na sajtu do sledećeg pokretanja)');
		}
	}

	const zaPotvrdu = [];
	let greske      = 0;
	for (const p of porudzbine) {
		const broj = p?.dokument?.Broj != null ? String(p.dokument.Broj) : '?';
		try {
			const rezultat = await upisiPorudzbinu(pool, p, prefiks);
			zaPotvrdu.push(broj);
			ukupno[rezultat]++;
			log(`  ${prefiks}${broj}: ` + (rezultat === 'upisana'
				? `upisana (${p.stavke.length} stavki, ${p.placanja.length} plaćanja)`
				: 'već postoji u COMITUPIS, samo se potvrđuje'));
		} catch (e) {
			greske++;
			ukupno.greska++;
			log(`  ${prefiks}${broj}: GREŠKA ${poruka(e)} (ništa nije upisano)`);
		}
	}

	// potvrda: sajt označava porudžbine kao prenete (DatPrenComit), sa originalnim brojem, bez test prefiksa
	if (zaPotvrdu.length) {
		let potvrda;
		try {
			potvrda = await http(cfg, 'potvrda', { brojevi: zaPotvrdu });
		} catch (e) {
			kraj(poruka(e) + ' (upisane porudžbine se potvrđuju u sledećem pokretanju)');
		}
		const nepoznato = potvrda.nepoznato ?? [];
		log(`potvrđeno: ${(potvrda.oznaceno ?? []).length}, već potvrđeno: ${(potvrda.vec_oznaceno ?? []).length}`
			+ (nepoznato.length ? `, nepoznato na sajtu: ${nepoznato.join(', ')}` : ''));
	}

	// neuspele porudžbine nisu potvrđene, pa bi ih sledeći poziv opet vratio; pokušavaju se u sledećem pokretanju
	if (greske) {
		izlaz = 1;
		break;
	}
	if (!odgovor.ima_jos) {
		break;
	}
	if (krug === krugova) {
		log(`dostignut MAX_KRUGOVA (${krugova}), ostatak u sledećem pokretanju`);
	}
}

log(`kraj: upisano ${ukupno.upisana}, već postojalo ${ukupno.postoji}, grešaka ${ukupno.greska}`);
process.exit(izlaz);
