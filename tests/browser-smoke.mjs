import { chromium } from "@playwright/test";
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://localhost:3000");
await page.getByRole("heading", { name: /Ask Katha/ }).waitFor();
await page.screenshot({ path: "qa/desktop.png" });
const textarea = page.locator("textarea");
await textarea.fill("Hello Katha");
await page.getByRole("button", { name: /send/i }).click();
await page.getByText(/Your message is saved/).waitFor();
await page.screenshot({ path: "qa/conversation.png" });
await page.setViewportSize({ width: 375, height: 812 });
await page.screenshot({ path: "qa/mobile.png" });
if (
  await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
)
  throw Error("Mobile horizontal overflow");
if (errors.length) throw Error(errors.join("\n"));
console.log("Desktop + mobile conversation smoke passed");
await browser.close();
