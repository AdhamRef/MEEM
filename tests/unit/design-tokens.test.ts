import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve("src/app/globals.css"), "utf8");

function token(name: string): string {
  const value = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6});`))?.[1];
  if (!value) throw new Error(`Token --${name} is not a hex colour in globals.css`);
  return value;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours. */
function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

const SURFACES = ["background", "surface", "surface-elevated"];

describe("contrast helper", () => {
  it("matches known WCAG values", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
  });
});

describe("design tokens meet WCAG AA", () => {
  it.each(SURFACES)("all text colours are readable on %s", (surface) => {
    for (const text of ["text-primary", "text-secondary", "muted", "danger"]) {
      expect(contrast(token(text), token(surface)), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(SURFACES)("the accent is readable as text on %s", (surface) => {
    expect(contrast(token("accent"), token(surface))).toBeGreaterThanOrEqual(4.5);
  });

  it("text on an accent button is readable", () => {
    expect(contrast(token("on-accent"), token("accent"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the specification's core palette", () => {
    expect(token("background").toLowerCase()).toBe("#090b10");
    expect(token("surface").toLowerCase()).toBe("#11151d");
    expect(token("surface-elevated").toLowerCase()).toBe("#191f2a");
    expect(token("border").toLowerCase()).toBe("#252c38");
    expect(token("text-primary").toLowerCase()).toBe("#f4f5f7");
    expect(token("text-secondary").toLowerCase()).toBe("#a5adba");
    expect(token("accent").toLowerCase()).toBe("#2bb3a3");
  });
});

describe("stylesheet direction", () => {
  it("uses no physical direction properties", () => {
    expect(css).not.toMatch(/(margin|padding|border)-(left|right)\b/);
    expect(css).not.toMatch(/^\s*(left|right):/m);
    expect(css).not.toMatch(/text-align:\s*(left|right)/);
  });
});
