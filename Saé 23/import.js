// import.js
// Lance avec : node import.js
// Ce script lit etudiants.json + villes.csv, fait la correspondance ville,
// et remplit les 3 tables SQL : groupe_projet, lieu, personne

const fs    = require("fs");
const path  = require("path");
const mysql = require("mysql2/promise");

// ── Connexion MySQL ──────────────────────────────────────────────────────────
const DB_CONFIG = {
    host:     "localhost",
    user:     "root",
    password: "",
    database: "test23"
};

// ── Lecture des fichiers ─────────────────────────────────────────────────────
const etudiants = JSON.parse(fs.readFileSync(path.join(__dirname, "ressources", "etudiants.json"), "utf8"));
const csvBrut   = fs.readFileSync(path.join(__dirname, "ressources", "villes.csv"), "utf8");

// ── Parsing du CSV ───────────────────────────────────────────────────────────
// Colonnes : dep,nom,cp,nb_hab_2010,nb_hab_1999,nb_hab_2012,dens,surf,long,lat,alt_min,alt_max
const villes = [];
const lignes = csvBrut.split("\n").slice(1); // on saute l'entête

for (const ligne of lignes) {
    const cols = ligne.trim().split(",");
    if (cols.length < 12) continue;

    villes.push({
        dep:          cols[0].trim(),
        nom:          cols[1].trim(),
        cp:           cols[2].trim(),
        nb_hab_2010:  cols[3].trim() || null,
        nb_hab_1999:  cols[4].trim() || null,
        nb_hab_2012:  cols[5].trim() || null,
        dens:         cols[6].trim() || null,
        surf:         cols[7].trim() || null,
        long:         cols[8].trim() || null,
        lat:          cols[9].trim() || null,
        alt_min:      cols[10].trim() || null,
        alt_max:      cols[11].trim() || null,
    });
}

console.log(`CSV chargé : ${villes.length} villes`);

// ── Fonction : trouver une ville dans le CSV ─────────────────────────────────
// Stratégie :
//   1. Cherche un code postal à 5 chiffres dans l'adresse → correspondance CP
//   2. Sinon cherche le nom de ville entre parenthèses : ex "(Montbéliard)"
//   3. Sinon cherche le dernier mot significatif de l'adresse
function trouverVille(adresse) {
    if (!adresse || adresse.trim() === "" || adresse.toLowerCase() === "aucune") return null;

    const adresseLower = adresse.toLowerCase();

    // 1. Cherche un code postal 5 chiffres
    const matchCP = adresse.match(/\b(\d{5})\b/);
    if (matchCP) {
        const cp = matchCP[1];
        const ville = villes.find(v => v.cp === cp);
        if (ville) return ville;
    }

    // 2. Cherche un nom entre parenthèses ex: "(Montbéliard)"
    const matchParentheses = adresse.match(/\(([^)]+)\)/);
    if (matchParentheses) {
        const nomRecherche = matchParentheses[1].toLowerCase().trim();
        const ville = villes.find(v =>
            v.nom.toLowerCase() === nomRecherche ||
            v.nom.toLowerCase().includes(nomRecherche) ||
            nomRecherche.includes(v.nom.toLowerCase())
        );
        if (ville) return ville;
    }

    // 3. Cherche par mots-clés dans l'adresse (du plus long au plus court)
    // On prend chaque mot de l'adresse et on cherche une correspondance
    const mots = adresse
        .replace(/[0-9]/g, " ")       // retire les chiffres
        .replace(/[^a-zA-ZÀ-ÿ\s-]/g, " ") // garde lettres + tirets
        .split(/\s+/)
        .filter(m => m.length > 3)    // ignore les mots courts
        .reverse();                    // on commence par la fin (souvent la ville)

    for (const mot of mots) {
        const ville = villes.find(v =>
            v.nom.toLowerCase() === mot.toLowerCase() ||
            v.nom.toLowerCase().replace(/-/g, " ") === mot.toLowerCase()
        );
        if (ville) return ville;
    }

    // 4. Recherche partielle en dernier recours
    for (const mot of mots) {
        const ville = villes.find(v =>
            v.nom.toLowerCase().includes(mot.toLowerCase()) ||
            mot.toLowerCase().includes(v.nom.toLowerCase())
        );
        if (ville) return ville;
    }

    return null; // aucune correspondance trouvée
}

// ── Script principal ─────────────────────────────────────────────────────────
async function main() {
    const db = await mysql.createConnection(DB_CONFIG);
    console.log("Connecté à MySQL ✓\n");

    // ── Étape 1 : Vider les tables (repart de zéro) ──────────────────────────
    // L'ordre est important à cause des clés étrangères
    await db.query("SET FOREIGN_KEY_CHECKS = 0");
    await db.query("TRUNCATE TABLE personne");
    await db.query("TRUNCATE TABLE lieu");
    await db.query("TRUNCATE TABLE groupe_projet");
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
    console.log("Tables vidées ✓");

    // ── Étape 2 : Insérer les groupes uniques ────────────────────────────────
    const groupesUniques = [...new Set(etudiants.map(e => e.groupe))].sort((a, b) => a - b);

    for (const idGroupe of groupesUniques) {
        await db.query("INSERT INTO groupe_projet (ID) VALUES (?)", [idGroupe]);
    }
    console.log(`${groupesUniques.length} groupes insérés ✓`);

    // ── Étape 3 : Collecter toutes les villes nécessaires ────────────────────
    // On collecte les noms de villes uniques pour la table lieu
    const villesAInserer = new Map(); // nom_ville → objet ville CSV

    for (const etudiant of etudiants) {
        const vp = trouverVille(etudiant.adresse_principale);
        const vs = trouverVille(etudiant.adresse_secondaire);
        const vn = trouverVille(etudiant.lieu_naissance || "");

        if (vp && !villesAInserer.has(vp.nom)) villesAInserer.set(vp.nom, vp);
        if (vs && !villesAInserer.has(vs.nom)) villesAInserer.set(vs.nom, vs);
        if (vn && !villesAInserer.has(vn.nom)) villesAInserer.set(vn.nom, vn);
    }

    // ── Étape 4 : Insérer les villes dans la table lieu ──────────────────────
    for (const [nomVille, v] of villesAInserer) {
        await db.query(
            `INSERT INTO lieu
                (Nom, Code_postale, Departement, Pays,
                 Population_2010, Population_1999, Population_2012,
                 Densitee, Surface, Longitude, Latitude, Altitude_min, Altitude_max)
             VALUES (?, ?, ?, 'France', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                v.nom, v.cp, v.dep,
                v.nb_hab_2010, v.nb_hab_1999, v.nb_hab_2012,
                v.dens, v.surf, v.long, v.lat,
                v.alt_min, v.alt_max
            ]
        );
    }
    console.log(`${villesAInserer.size} villes insérées dans lieu ✓`);

    // ── Étape 5 : Insérer les personnes ─────────────────────────────────────
    let nbOk = 0;
    let nbErreur = 0;

    for (const e of etudiants) {
        const vp = trouverVille(e.adresse_principale);
        const vs = trouverVille(e.adresse_secondaire);
        const vn = trouverVille(e.lieu_naissance || "");

        const nomVillePrincipale  = vp ? vp.nom : null;
        const nomVilleSecondaire  = vs ? vs.nom : null;
        const nomLieuNaissance    = e.lieu_naissance || (vn ? vn.nom : null);

        // Génère un email si absent
        const email = e.email ||
            `${e.prenom.toLowerCase().replace(/\s/g, ".")}.${e.nom.toLowerCase().replace(/\s/g, ".")}@etudiant.univ-fcomte.fr`;

        if (!vp) {
            console.warn(`⚠ Ville principale non trouvée pour : ${e.prenom} ${e.nom} (adresse: "${e.adresse_principale}")`);
            nbErreur++;
        }

        try {
            await db.query(
                `INSERT INTO personne
                    (Email, Nom, Prenom, ID_Groupe,
                     Id_Residence_Principale, Id_Residence_Secondaire, Lieu_Naissance)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    email,
                    e.nom,
                    e.prenom,
                    e.groupe,
                    nomVillePrincipale,
                    nomVilleSecondaire,
                    nomLieuNaissance
                ]
            );
            nbOk++;
        } catch (err) {
            console.error(`✗ Erreur insertion ${e.prenom} ${e.nom} :`, err.message);
            nbErreur++;
        }
    }

    console.log(`\n✅ Import terminé :`);
    console.log(`   ${nbOk} personnes insérées avec succès`);
    if (nbErreur > 0) console.log(`   ${nbErreur} erreurs (voir avertissements ci-dessus)`);

    await db.end();
}

main().catch(err => {
    console.error("Erreur fatale :", err.message);
    process.exit(1);
});



/*Ce que fait le script :
Il lit chaque adresse du JSON et cherche la ville correspondante dans le CSV avec 4 méthodes dans l'ordre :

Code postal 5 chiffres (25200 → Montbéliard)
Nom entre parenthèses ((Montbéliard))
Dernier mot significatif de l'adresse
Recherche partielle en dernier recours*/
