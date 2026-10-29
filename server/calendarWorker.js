import { parentPort, workerData, Worker } from "node:worker_threads";
import * as calendar from "./calendarIcs.js";

if (parentPort) {
  try {
    parentPort.postMessage({
      result: calendar[workerData.operation](...workerData.args),
    });
  } catch (error) {
    parentPort.postMessage({
      error: error.message,
      status: error.status || 400,
    });
  }
}

// Recurrence rules and ICS files are untrusted. Bound CPU and memory outside
// the HTTP event loop, including pathological rules inside iterator.next().
let active = 0;
const queue = [];
export async function runCalendar(operation, ...args) {
  if (active >= 2) {
    if (queue.length >= 12)
      throw new calendar.CalendarError(
        "Die Kalenderverarbeitung ist ausgelastet. Bitte kurz warten.",
        429,
      );
    await new Promise((resolve) => queue.push(resolve));
  } else active++;
  try {
    return await execute(operation, args);
  } finally {
    const next = queue.shift();
    if (next) next();
    else active--;
  }
}
function execute(operation, args) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { operation, args },
      resourceLimits: { maxOldGenerationSizeMb: 96, stackSizeMb: 4 },
    });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(
        new calendar.CalendarError(
          "Die Kalenderverarbeitung hat das Zeitlimit überschritten. Bitte erneut laden.",
          503,
        ),
      );
    }, 5000);
    worker.once("message", (message) => {
      clearTimeout(timer);
      worker.terminate();
      message.error
        ? reject(new calendar.CalendarError(message.error, message.status))
        : resolve(message.result);
    });
    worker.once("error", () => {
      clearTimeout(timer);
      reject(
        new calendar.CalendarError(
          "Der Kalender konnte nicht verarbeitet werden.",
          422,
        ),
      );
    });
    worker.once("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0)
        reject(
          new calendar.CalendarError(
            "Die Kalenderverarbeitung wurde beendet.",
            422,
          ),
        );
    });
  });
}
