// Mock "personal life" items — the actual product vision: calendar invites, unread-email
// summaries, reminders. These stand in for what would later be real connectors (Google
// Calendar, Gmail, etc.). They demonstrate the "ambient personal push" feel with zero PII.
import { makeId } from "./util.js";

export const meta = { id: "mock", label: "Personal", kind: "note", needsConfig: false };

const CALENDAR = [
  { title: "Standup with Platform team", body: "Today 10:30 · 30 min · Google Meet", url: "https://calendar.google.com/" },
  { title: "1:1 with Dana", body: "Tomorrow 14:00 · 45 min · Room Birch", url: "https://calendar.google.com/" },
  { title: "Dentist appointment", body: "Thu 09:00 · Dr. Okafor · bring insurance card", url: "https://calendar.google.com/" },
  { title: "Flight LH441 → SFO", body: "Sat 11:20 · check in opens in 18h", url: "https://calendar.google.com/" },
];

const EMAIL = [
  { title: "Stripe: payout of $1,204 sent", body: "Expected in your account in 1–2 business days.", url: "https://mail.google.com/" },
  { title: "3 unread from #design-review", body: "Latest: \"Can we ship the new card spacing?\"", url: "https://mail.google.com/" },
  { title: "Invoice #2025-118 is overdue", body: "Acme Corp · $480 · 4 days past due", url: "https://mail.google.com/" },
  { title: "Your weekly summary is ready", body: "12 emails archived · 3 need a reply · 1 follow-up due", url: "https://mail.google.com/" },
];

const NOTES = [
  { title: "Reminder: water the plants", body: "You set this for every 3 days.", url: null },
  { title: "Drink some water 💧", body: "It's been a while since your last break.", url: null },
  { title: "TODO from yesterday", body: "“Reply to the landlord about the lease renewal.”", url: null },
];

function take(arr, kind, label, n, seed) {
  // Rotate deterministically by a moving seed so successive refills surface different items.
  const out = [];
  for (let i = 0; i < n; i++) {
    const it = arr[(seed + i) % arr.length];
    out.push({
      id: makeId("mock", kind + ":" + it.title + ":" + ((seed + i) % arr.length)),
      source: "mock",
      sourceLabel: label,
      kind,
      title: it.title,
      body: it.body,
      imageUrl: null,
      url: it.url,
      author: null,
      ts: new Date().toISOString(),
    });
  }
  return out;
}

let tick = 0;
export async function fetch_(count = 3) {
  tick++;
  return [
    ...take(CALENDAR, "calendar", "Calendar", 1, tick),
    ...take(EMAIL, "email", "Email", 1, tick),
    ...take(NOTES, "note", "Reminder", 1, tick),
  ].slice(0, count);
}
