// Envoie une annonce MetalFlix sur un webhook Discord, ping @everyone compris.
//
// Usage :
//   node scripts/send-discord.mjs discord-update-2026-11-14.json
//
// L'URL du webhook est lue dans .discord-webhook (première ligne, jamais commité)
// ou dans la variable d'environnement DISCORD_WEBHOOK. Elle n'est jamais affichée.
import { readFileSync, existsSync } from "node:fs";

const payloadPath = process.argv[2] ?? "discord-update-2026-11-14.json";

function readWebhookUrl() {
  if (process.env.DISCORD_WEBHOOK?.trim()) return process.env.DISCORD_WEBHOOK.trim();
  if (existsSync(".discord-webhook")) {
    const line = readFileSync(".discord-webhook", "utf8")
      .split(/\r?\n/)
      .map((value) => value.trim())
      .find((value) => value.startsWith("https://"));
    if (line) return line;
  }
  return "";
}

const url = readWebhookUrl();
if (!url) {
  console.error(
    "Aucune URL de webhook. Colle-la dans .discord-webhook (une seule ligne) ou exporte DISCORD_WEBHOOK.",
  );
  process.exit(1);
}

const payload = JSON.parse(readFileSync(payloadPath, "utf8"));

// Components V2 n'affiche pas `content`, donc la mention est dans un bloc de texte.
// `allowed_mentions` est indispensable : sans lui, un webhook ne notifie que les
// mentions d'utilisateurs et `@everyone` reste gris.
payload.content = payload.content ?? "";
payload.allowed_mentions = { parse: ["everyone"] };

// Components V2 par webhook exige `with_components=true`, sinon Discord ne voit
// aucun composant et répond 400 « Cannot send an empty message ».
const response = await fetch(`${url}?wait=true&with_components=true`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});

const body = await response.text();
if (!response.ok) {
  console.error(`Échec ${response.status}: ${body}`);
  process.exit(1);
}

const message = JSON.parse(body);
console.log(`Envoyé — message ${message.id} dans le salon ${message.channel_id}`);
console.log(`Mention @everyone autorisée : ${JSON.stringify(message.mentions)}`);
