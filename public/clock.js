const clock = document.getElementById("clock");
if (clock) {
  const format = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  });

  function tick() {
    const now = new Date();
    clock.dateTime = now.toISOString();
    clock.textContent = format.format(now) + " UTC";
  }

  tick();
  setInterval(tick, 1000);
}
