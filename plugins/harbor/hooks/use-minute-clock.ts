import { useEffect, useState } from "react";

export function useMinuteClock(): number {
  const [minute, setMinute] = useState(() =>
    Math.floor(Date.now() / 60_000),
  );

  useEffect(() => {
    const timer = setInterval(
      () => setMinute(Math.floor(Date.now() / 60_000)),
      60_000,
    );
    return () => clearInterval(timer);
  }, []);

  return minute * 60_000;
}
