const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

function startOfDay(ms: number) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function dayOffset(ms: number, now: number) {
  return Math.round((startOfDay(now) - startOfDay(ms)) / (24 * HOUR));
}

/** Short age for lists: "Now", "4m", "3h", "Yesterday", "Oct 19". */
export function shortAge(ms: number, now = Date.now()) {
  const age = now - ms;
  if (age < MINUTE) return "Now";
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m`;
  if (dayOffset(ms, now) === 0) return `${Math.floor(age / HOUR)}h`;
  if (dayOffset(ms, now) === 1) return "Yesterday";
  return new Date(ms).toLocaleDateString("en", { month: "short", day: "numeric" });
}

/** "Updated 2m ago" style text. */
export function updatedAgo(ms: number, now = Date.now()) {
  const age = shortAge(ms, now);
  if (age === "Now") return "Updated just now";
  if (age === "Yesterday") return "Updated yesterday";
  if (/^\d+[mh]$/.test(age)) return `Updated ${age} ago`;
  return `Updated ${age}`;
}

/** Version timeline label: "Today, 9:35 PM", "Yesterday, 11:15 PM", "Oct 19, 9:02 AM". */
export function timelineTime(ms: number, now = Date.now()) {
  const time = new Date(ms).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" });
  const offset = dayOffset(ms, now);
  if (offset === 0) return `Today, ${time}`;
  if (offset === 1) return `Yesterday, ${time}`;
  const day = new Date(ms).toLocaleDateString("en", { month: "short", day: "numeric" });
  return `${day}, ${time}`;
}
