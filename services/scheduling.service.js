import pool from "../config/db.js";

const START_TIME = 8;
const END_TIME = 17;
const SLOT_MINUTES = 30;
const MAX_JOBS_PER_DAY = 10;
const LOOKAHEAD_DAYS = 14;

function generateDaySlots(date) {
  const slots = [];

  for (let hour = START_TIME; hour < END_TIME; hour++) {
    for (let min = 0; min < 60; min += SLOT_MINUTES) {

      const h = String(hour).padStart(2, "0");
      const m = String(min).padStart(2, "0");

      slots.push({
        date,
        time: `${h}:${m}`
      });

    }
  }

  return slots;
}

export async function getAvailableSlots(residencyId) {

  const today = new Date();
  const slots = [];

  for (let i = 0; i < LOOKAHEAD_DAYS; i++) {

    const d = new Date(today);
    d.setDate(today.getDate() + i);

    const date = d.toISOString().split("T")[0];

    const daySlots = generateDaySlots(date);

    slots.push(...daySlots);

  }

  const { rows } = await pool.query(
    `
    SELECT scheduled_date, scheduled_time
    FROM maintenance_requests
    WHERE residency_id = $1
    AND scheduled_date IS NOT NULL
    AND status != 'cancelled'
    `,
    [residencyId]
  );

  const booked = new Set(
    rows.map(r => `${r.scheduled_date}_${r.scheduled_time}`)
  );

  const available = slots.filter(slot => {
    const key = `${slot.date}_${slot.time}`;
    return !booked.has(key);
  });

  return available;
}

export async function getNextAvailableSlot(residencyId) {

  const slots = await getAvailableSlots(residencyId);

  if (!slots.length) return null;

  return slots[0];
}