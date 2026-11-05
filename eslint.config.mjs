import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * Physical direction classes break the RTL layout and any later left-to-right translation.
 * Use logical ones instead: ms-/me-, ps-/pe-, start-/end-, border-s/border-e, text-start/text-end.
 */
const PHYSICAL_DIRECTION_CLASS =
  "(^|[\\s:])(-?(ml|mr|pl|pr|left|right|scroll-ml|scroll-mr|scroll-pl|scroll-pr)-|(border|rounded)-(l|r|tl|tr|bl|br)(-|\\s|$)|(text|float|clear|origin|bg)-(left|right)(\\s|$)|slide-(in|out)-(from|to)-(left|right)(-|\\s|$))";
const PHYSICAL_DIRECTION_MESSAGE =
  "Use a logical direction class (ms-, me-, ps-, pe-, start-, end-, border-s, border-e, text-start, text-end). The site is RTL.";

const config = [
  { ignores: [".next/**", "node_modules/**", "coverage/**", "playwright-report/**", "test-results/**", ".data/**", "next-env.d.ts"] },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    files: ["src/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: `Literal[value=/${PHYSICAL_DIRECTION_CLASS}/]`, message: PHYSICAL_DIRECTION_MESSAGE },
        { selector: `TemplateElement[value.raw=/${PHYSICAL_DIRECTION_CLASS}/]`, message: PHYSICAL_DIRECTION_MESSAGE },
      ],
    },
  },
];

export default config;
