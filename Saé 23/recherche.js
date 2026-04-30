// ── Carte Leaflet ────────────────────────────────────────────────────────────
const map = L.map('map').setView([46.603354, 1.888334], 6);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

let marker = null;

window.addEventListener("load", () => {
    setTimeout(() => map.invalidateSize(), 300);
});

// ── Éléments HTML ────────────────────────────────────────────────────────────
const searchInput      = document.getElementById("search");
const suggestionsBox   = document.getElementById("suggestions");
const listeSuggestions = document.getElementById("liste-suggestions");

// ── Suggestions en temps réel ────────────────────────────────────────────────
searchInput.addEventListener("input", async () => {
    const saisie = searchInput.value.trim();

    if (saisie.length === 0) {
        listeSuggestions.innerHTML = "";
        suggestionsBox.style.display = "none";
        return;
    }

    try {
        const response = await fetch(`http://localhost:3000/api/suggestions?search=${encodeURIComponent(saisie)}`);
        const personnes = await response.json();

        listeSuggestions.innerHTML = "";

        if (personnes.length === 0) {
            suggestionsBox.style.display = "none";
            return;
        }

        personnes.forEach(p => {
            const nomComplet = p.Nom + " " + p.Prenom;
            const li = document.createElement("li");
            li.textContent = nomComplet;

            li.addEventListener("click", async () => {
                searchInput.value = nomComplet;
                suggestionsBox.style.display = "none";
                await chargerPersonne(p.Email);
            });

            listeSuggestions.appendChild(li);
        });

        suggestionsBox.style.display = "block";

    } catch (err) {
        console.error("Erreur suggestions :", err);
    }
});

// Cache les suggestions si on clique ailleurs
document.addEventListener("click", (e) => {
    if (!searchInput.contains(e.target) && !suggestionsBox.contains(e.target)) {
        suggestionsBox.style.display = "none";
    }
});

// ── Chargement complet d'une personne ────────────────────────────────────────
async function chargerPersonne(email) {
    try {
        const response = await fetch(`http://localhost:3000/api/personne/${encodeURIComponent(email)}`);

        if (!response.ok) {
            console.error("Personne introuvable");
            return;
        }

        const data = await response.json();
        const rp   = data.residence_principale;

        // ── Bloc "Information personnelle" ────────────────────────────────
        setTexte("email",       "Email : "             + data.email);
        setTexte("nom",         "Nom : "               + data.nom);
        setTexte("prenom",      "Prénom : "            + data.prenom);
        setTexte("ville",       "Ville : "             + rp.ville);
        setTexte("naissance",   "Lieu de naissance : " + data.lieu_naissance);
        setTexte("nationalite", "Nationalité : France"); // pas dans la BDD
        setTexte("groupe",      "Numéro de groupe : "  + data.groupe);

        // ── Bloc "Information de la ville" ────────────────────────────────
        setTexte("code-postal",  "Code postal : "  + rp.code_postal);
        setTexte("departement",  "Département : "  + rp.departement);
        setTexte("population",   "Population : "   + rp.population);
        setTexte("densite",      "Densité : "      + rp.densite + " hab/km²");
        setTexte("pays",         "Pays : "         + rp.pays);
        setTexte("surface",      "Surface : "      + rp.surface + " km²");
        setTexte("longitude",    "Longitude : "    + rp.longitude);
        setTexte("altitude-max", "Altitude max : " + rp.altitude_max + " m");
        setTexte("latitude",     "Latitude : "     + rp.latitude);
        setTexte("altitude-min", "Altitude min : " + rp.altitude_min + " m");

        // ── Mise à jour de la carte ───────────────────────────────────────
        if (rp.latitude && rp.longitude) {
            const coords = [rp.latitude, rp.longitude];
            map.setView(coords, 12);

            if (marker) {
                marker.setLatLng(coords);
            } else {
                marker = L.marker(coords).addTo(map);
            }

            marker.bindPopup("<strong>" + rp.ville + "</strong>").openPopup();
        }

    } catch (err) {
        console.error("Erreur chargement personne :", err);
    }
}

// ── Utilitaire ───────────────────────────────────────────────────────────────
function setTexte(id, texte) {
    const el = document.getElementById(id);
    if (el) el.textContent = texte;
}

// ── Menu burger ──────────────────────────────────────────────────────────────
function toggleMenu() {
    document.getElementById("burger-menu").classList.toggle("show");
}