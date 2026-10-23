// Briše test porudžbine (Broj počinje sa TEST-, upisane sa PREFIKS_BROJA=TEST-) iz sve tri tabele COMITUPIS-a,
// u jednoj transakciji. Prave porudžbine (Broj bez prefiksa) nikad ne dira.
//   node obrisi-test.js        samo ispiše šta bi obrisao
//   node obrisi-test.js --da   briše
import sql from 'mssql';
import { TABELE, TEST_PREFIKS, config, ispis, kraj, log, mssql, poruka } from './lib.js';

const brisi = process.argv.includes('--da');
const cfg   = config();
let pool;
try {
	pool = await mssql(cfg.mssql);
} catch (e) {
	kraj('COMITUPIS: ' + poruka(e));
}

const uslov = `Broj LIKE '${TEST_PREFIKS}%'`;
const broj  = {};
for (const tabela of TABELE) {
	broj[tabela] = (await pool.request().query(`SELECT COUNT(*) AS n FROM ${tabela} WHERE ${uslov}`)).recordset[0].n;
}
const porudzbine = (await pool.request().query(`SELECT RTRIM(Broj) AS Broj FROM PPC_Dokument WHERE ${uslov} ORDER BY Broj`))
	.recordset.map(red => red.Broj);
ispis('test porudžbine: ' + (porudzbine.length ? porudzbine.join(', ') : '(nema)'));
for (const [tabela, n] of Object.entries(broj)) {
	ispis(`  ${tabela}: ${n} redova`);
}
if (!brisi) {
	ispis('ništa nije obrisano; za brisanje: node obrisi-test.js --da');
	process.exit(0);
}

const transakcija = new sql.Transaction(pool);
try {
	await transakcija.begin();
	for (const tabela of [...TABELE].reverse()) {
		await new sql.Request(transakcija).query(`DELETE FROM ${tabela} WHERE ${uslov}`);
	}
	await transakcija.commit();
} catch (e) {
	try {
		await transakcija.rollback();
	} catch {}
	kraj('brisanje: ' + poruka(e) + ' (rollback, ništa nije obrisano)');
}
log('obrisane test porudžbine iz COMITUPIS: ' + porudzbine.join(', '));
process.exit(0);
