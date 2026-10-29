export async function loadCalendarData(request, { start, end, zone }) {
  const results = await Promise.allSettled([
    request("/calendar/calendars"),
    request(
      `/calendar/events?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&timezone=${encodeURIComponent(zone)}`,
    ),
    request("/calendar/tasks"),
  ]);
  const data = { errors: [] };
  for (const [index, key] of ["calendars", "events", "tasks"].entries()) {
    const result = results[index];
    if (result.status === "fulfilled") data[key] = result.value;
    else
      data.errors.push({
        section: key,
        message: result.reason?.message || "HTTP error",
      });
  }
  return data;
}
