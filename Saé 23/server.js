const express    = require("express");
const mysql      = require("mysql2");
const cors       = require("cors");
const fs         = require("fs");
const path       = require("path");
const nodemailer = require("nodemailer");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ── Connexion MySQL ──────────────────────────────────────────────────────────
const db = mysql.createConnection({
    host:     "localhost",
    user:     "root",
    password: "",
    database: "test23"
});

db.connect(err => {
    if (err) {
        console.error("Erreur de connexion MySQL :", err.message);
        process.exit(1);
    }
    console.log("Connecté à MySQL ✓");
});

// ── Configuration Nodemailer ─────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: "supportdomicilometre@gmail.com",
        pass: "ljwnyvnbsxpdkema"
    }
});

// ── ROUTE : Suggestions de recherche ────────────────────────────────────────
app.get("/api/suggestions", (req, res) => {
    const search = req.query.search || "";
    const sql = `
        SELECT Email, Nom, Prenom
        FROM personne
        WHERE Nom    LIKE CONCAT(?, '%')
           OR Prenom LIKE CONCAT(?, '%')
        LIMIT 10
    `;
    db.query(sql, [search, search], (err, results) => {
        if (err) return res.status(500).json({ erreur: "Erreur SQL suggestions" });
        res.json(results);
    });
});

// ── ROUTE : Détail d'une personne ────────────────────────────────────────────
app.get("/api/personne/:email", (req, res) => {
    const email = req.params.email;
    const sql = `
        SELECT
            p.Email, p.Nom, p.Prenom, p.ID_Groupe,
            p.Id_Residence_Principale, p.Id_Residence_Secondaire, p.Lieu_Naissance,
            rp.Nom AS rp_ville, rp.Code_postale AS rp_code_postal,
            rp.Departement AS rp_departement, rp.Pays AS rp_pays,
            rp.Population_2012 AS rp_population, rp.Densitee AS rp_densite,
            rp.Surface AS rp_surface, rp.Longitude AS rp_longitude,
            rp.Latitude AS rp_latitude, rp.Altitude_min AS rp_altitude_min,
            rp.Altitude_max AS rp_altitude_max,
            rs.Nom AS rs_ville, rs.Code_postale AS rs_code_postal,
            rs.Departement AS rs_departement,
            ln.Nom AS ln_ville
        FROM personne p
        LEFT JOIN groupe_projet gp ON p.ID_Groupe = gp.ID
        LEFT JOIN lieu rp ON p.Id_Residence_Principale = rp.Nom
        LEFT JOIN lieu rs ON p.Id_Residence_Secondaire = rs.Nom
        LEFT JOIN lieu ln ON p.Lieu_Naissance = ln.Nom
        WHERE p.Email = ?
    `;
    db.query(sql, [email], (err, results) => {
        if (err)             return res.status(500).json({ erreur: "Erreur SQL détail" });
        if (!results.length) return res.status(404).json({ erreur: "Personne introuvable" });

        const row = results[0];
        res.json({
            email:  row.Email,
            nom:    row.Nom,
            prenom: row.Prenom,
            groupe: row.ID_Groupe,
            lieu_naissance: row.ln_ville || row.Lieu_Naissance || "Non renseigné",
            residence_principale: {
                ville:        row.rp_ville       || "Non renseignée",
                code_postal:  row.rp_code_postal || "-",
                departement:  row.rp_departement || "-",
                pays:         row.rp_pays        || "-",
                population:   row.rp_population  || "-",
                densite:      row.rp_densite      || "-",
                surface:      row.rp_surface      || "-",
                longitude:    row.rp_longitude    || null,
                latitude:     row.rp_latitude     || null,
                altitude_min: row.rp_altitude_min || "-",
                altitude_max: row.rp_altitude_max || "-"
            },
            residence_secondaire: row.rs_ville ? {
                ville:       row.rs_ville,
                code_postal: row.rs_code_postal || "-",
                departement: row.rs_departement || "-"
            } : null
        });
    });
});

// ── ROUTE : Inscription ──────────────────────────────────────────────────────
app.post("/api/inscription", (req, res) => {
    const nouvelEtudiant = req.body;

    // 1. Sauvegarde dans le fichier JSON
    const data = JSON.parse(fs.readFileSync('./ressources/etudiants.json', 'utf-8'));
    data.push(nouvelEtudiant);
    fs.writeFileSync('./ressources/etudiants.json', JSON.stringify(data, null, 2));

    // 2. Insertion MySQL sans vérification des clés étrangères
    db.query("SET FOREIGN_KEY_CHECKS = 0", (err) => {
        if (err) return res.status(500).json({ erreur: "Erreur SET FK" });

        const sql = `INSERT INTO personne
            (Email, Nom, Prenom, ID_Groupe, Id_Residence_Principale, Id_Residence_Secondaire, Lieu_Naissance)
            VALUES (?, ?, ?, ?, ?, ?, ?)`;
        const values = [
            nouvelEtudiant.email              || null,
            nouvelEtudiant.nom                || null,
            nouvelEtudiant.prenom             || null,
            nouvelEtudiant.groupe             || null,
            nouvelEtudiant.adresse_principale || null,
            nouvelEtudiant.adresse_secondaire || null,
            nouvelEtudiant.lieu_naissance     || null
        ];

        db.query(sql, values, (err, result) => {
            db.query("SET FOREIGN_KEY_CHECKS = 1", () => {});

            if (err) {
                console.error("Erreur SQL inscription :", err.message);
                return res.status(500).json({ erreur: "Erreur lors de l'enregistrement SQL" });
            }

            console.log("Étudiant ajouté avec l'ID :", result.insertId);

            if (nouvelEtudiant.email) {
                envoyerGuide(nouvelEtudiant.email).catch(err =>
                    console.error("Erreur envoi email :", err.message)
                );
            }

            res.json({ succes: true, message: "Inscription réussie !" });
        });
    });
});

// ── ROUTE : Envoi manuel du guide PDF ───────────────────────────────────────
app.post("/api/envoyer-guide", async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ erreur: "Email manquant" });

    try {
        await envoyerGuide(email);
        res.json({ succes: true, message: "Email envoyé avec succès" });
    } catch (err) {
        console.error("Erreur envoi email :", err.message);
        res.status(500).json({ erreur: "Échec envoi email" });
    }
});

// ── Fonction partagée d'envoi du guide ──────────────────────────────────────
async function envoyerGuide(email) {
    const pdfPath = path.join(__dirname, "ressources", "guide-utilisation.pdf");

    const attachments = [];
    if (fs.existsSync(pdfPath)) {
        attachments.push({ filename: "guide-utilisation.pdf", path: pdfPath });
    } else {
        console.warn("⚠ PDF non trouvé : ressources/guide-utilisation.pdf");
    }

    await transporter.sendMail({
        from:    '"Domicilomètre BUT R&T" <supportdomicilometre@gmail.com>',
        to:      email,
        subject: "Bienvenue sur le Domicilomètre — Votre guide d'utilisation",
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
                <h2 style="color: #7ea5d4;">Bienvenue sur le Domicilomètre !</h2>
                <p>Bonjour,</p>
                <p>Merci de vous être inscrit sur le
                   <strong>Domicilomètre des étudiants du BUT R&amp;T</strong>.</p>
                <p>Vous trouverez en pièce jointe votre
                   <strong>guide d'utilisation</strong> au format PDF.</p>
                <br>
                <p style="color:#999; font-size:13px;">
                    Université Marie &amp; Louis Pasteur — BUT R&amp;T
                </p>
            </div>
        `,
        attachments
    });

    console.log(`Email envoyé à : ${email}`);
}


// ── ROUTE : Membres d'un groupe ──────────────────────────────────────────────
app.get("/api/groupe/:id", (req, res) => {
    const idGroupe = parseInt(req.params.id);

    if (isNaN(idGroupe)) {
        return res.status(400).json({ erreur: "Numéro de groupe invalide" });
    }

    console.log(`Recherche groupe : ${idGroupe}`);

    const sql = `
        SELECT
            p.Email, p.Nom, p.Prenom, p.ID_Groupe,
            p.Lieu_Naissance,
            rp.Nom          AS rp_ville,
            rp.Code_postale AS rp_code_postal,
            rp.Departement  AS rp_departement,
            rp.Pays         AS rp_pays,
            rp.Population_2012 AS rp_population,
            rp.Densitee     AS rp_densite,
            rp.Surface      AS rp_surface,
            rp.Longitude    AS rp_longitude,
            rp.Latitude     AS rp_latitude,
            rp.Altitude_min AS rp_altitude_min,
            rp.Altitude_max AS rp_altitude_max,
            rs.Nom          AS rs_ville,
            rs.Code_postale AS rs_code_postal,
            rs.Departement  AS rs_departement,
            ln.Nom          AS ln_ville
        FROM personne p
        LEFT JOIN lieu rp ON p.Id_Residence_Principale = rp.Nom
        LEFT JOIN lieu rs ON p.Id_Residence_Secondaire = rs.Nom
        LEFT JOIN lieu ln ON p.Lieu_Naissance          = ln.Nom
        WHERE CAST(p.ID_Groupe AS UNSIGNED) = ?
        ORDER BY p.Nom, p.Prenom
    `;

    db.query(sql, [idGroupe], (err, results) => {
        if (err) {
            console.error("Erreur SQL groupe :", err.message);
            return res.status(500).json({ erreur: "Erreur SQL groupe" });
        }

        console.log(`Résultats trouvés : ${results.length}`);

        if (!results.length) return res.status(404).json({ erreur: "Groupe introuvable ou vide" });

        const membres = results.map(row => ({
            email:  row.Email,
            nom:    row.Nom,
            prenom: row.Prenom,
            groupe: row.ID_Groupe,
            lieu_naissance: row.ln_ville || row.Lieu_Naissance || "Non renseigné",
            residence_principale: {
                ville:        row.rp_ville        || "Non renseignée",
                code_postal:  row.rp_code_postal  || "-",
                departement:  row.rp_departement  || "-",
                pays:         row.rp_pays         || "-",
                population:   row.rp_population   || "-",
                densite:      row.rp_densite       || "-",
                surface:      row.rp_surface       || "-",
                longitude:    row.rp_longitude     || null,
                latitude:     row.rp_latitude      || null,
                altitude_min: row.rp_altitude_min  || "-",
                altitude_max: row.rp_altitude_max  || "-"
            },
            residence_secondaire: row.rs_ville ? {
                ville:       row.rs_ville,
                code_postal: row.rs_code_postal || "-",
                departement: row.rs_departement || "-"
            } : null
        }));

        res.json({ groupe: idGroupe, total: membres.length, membres });
    });
});


// ── Démarrage du serveur ─────────────────────────────────────────────────────
app.listen(3000, () => {
    console.log("Serveur lancé → http://localhost:3000");
});