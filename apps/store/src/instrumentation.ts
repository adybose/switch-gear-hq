// Runs once when the Next.js server starts. Starts the store's background timers.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startTimers } = await import('./server/timers');
  startTimers();
}
