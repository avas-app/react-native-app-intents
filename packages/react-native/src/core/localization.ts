import type { LocalizedText } from "./schema.js";

/** Locale used for generated artifacts when a project does not configure one. */
export const DEFAULT_LOCALE = "en";

/** Options controlling which locale a localized value resolves to. */
export interface LocaleResolutionOptions {
  /** Locale to resolve. Falls back to `defaultLocale` when the value has no entry for it. */
  locale?: string;
  /** Project default locale. Defaults to `"en"`. */
  defaultLocale?: string;
}

const LANGUAGE_PATTERN = /^[A-Za-z]{2,3}$/;
const SCRIPT_PATTERN = /^[A-Za-z]{4}$/;
const REGION_PATTERN = /^(?:[A-Za-z]{2}|[0-9]{3})$/;

/**
 * Canonicalizes a BCP 47 locale tag so lookups are case-insensitive and separator-insensitive.
 *
 * `pt_br` and `PT-BR` both normalize to `pt-BR`, which is the form used for Apple `.lproj`
 * directory names and the basis for Android resource qualifiers.
 */
export function normalizeLocaleTag(locale: string): string {
  const subtags = locale.trim().split(/[-_]/).filter(Boolean);
  const language = subtags[0];

  if (!language || !LANGUAGE_PATTERN.test(language)) {
    return locale.trim();
  }

  const parts = [language.toLowerCase()];
  let index = 1;

  const script = subtags[index];

  if (script && SCRIPT_PATTERN.test(script)) {
    parts.push(script[0]!.toUpperCase() + script.slice(1).toLowerCase());
    index += 1;
  }

  const region = subtags[index];

  if (region && REGION_PATTERN.test(region)) {
    parts.push(region.toUpperCase());
    index += 1;
  }

  return [...parts, ...subtags.slice(index)].join("-");
}

function isLocaleMap(value: LocalizedText): value is Record<string, string> {
  return typeof value !== "string";
}

/** Adds every locale referenced by a localized value to `into`. */
export function collectLocalizedTextLocales(
  value: LocalizedText | undefined,
  into: Set<string>,
): void {
  if (value === undefined || !isLocaleMap(value)) {
    return;
  }

  for (const [locale, text] of Object.entries(value)) {
    if (typeof text === "string") {
      into.add(normalizeLocaleTag(locale));
    }
  }
}

/** Adds every locale referenced by a localized phrase list to `into`. */
export function collectPhraseLocales(
  phrases: readonly string[] | Partial<Record<string, readonly string[]>> | undefined,
  into: Set<string>,
): void {
  if (!phrases || Array.isArray(phrases)) {
    return;
  }

  for (const [locale, list] of Object.entries(
    phrases as Partial<Record<string, readonly string[]>>,
  )) {
    if (Array.isArray(list)) {
      into.add(normalizeLocaleTag(locale));
    }
  }
}

function lookupLocalizedEntry(
  value: Record<string, string>,
  locale: string | undefined,
): string | undefined {
  if (!locale) {
    return undefined;
  }

  const normalizedLocale = normalizeLocaleTag(locale);

  for (const [candidateLocale, text] of Object.entries(value)) {
    if (typeof text === "string" && normalizeLocaleTag(candidateLocale) === normalizedLocale) {
      return text;
    }
  }

  const language = normalizedLocale.split("-")[0];

  if (!language || language === normalizedLocale) {
    return undefined;
  }

  for (const [candidateLocale, text] of Object.entries(value)) {
    if (typeof text === "string" && normalizeLocaleTag(candidateLocale) === language) {
      return text;
    }
  }

  return undefined;
}

/**
 * Resolves localized text down to a single string.
 *
 * Resolution order is the requested locale, then the requested locale's bare language, then the
 * project default locale, then `en`, then the first declared entry, then `fallback`.
 */
export function resolveLocalizedText(
  value: LocalizedText | undefined,
  fallback?: string,
  options: LocaleResolutionOptions = {},
): string | undefined {
  if (value === undefined) {
    return fallback;
  }

  if (!isLocaleMap(value)) {
    return value;
  }

  const defaultLocale = options.defaultLocale ?? DEFAULT_LOCALE;

  const requested = lookupLocalizedEntry(value, options.locale);

  if (requested !== undefined) {
    return requested;
  }

  const fallbackLocale = lookupLocalizedEntry(value, defaultLocale);

  if (fallbackLocale !== undefined) {
    return fallbackLocale;
  }

  const english = lookupLocalizedEntry(value, DEFAULT_LOCALE);

  if (english !== undefined) {
    return english;
  }

  const firstEntry = Object.values(value).find((entry) => typeof entry === "string");

  return firstEntry ?? fallback;
}

/**
 * Resolves a localized phrase list for a locale.
 *
 * Unlike {@link resolveLocalizedText} this does not fall back to another locale's list, because a
 * missing translation should leave that locale's phrases untranslated rather than duplicating the
 * default locale under a translated key.
 */
export function resolvePhrasesForLocale(
  phrases: readonly string[] | Partial<Record<string, readonly string[]>> | undefined,
  locale: string,
): readonly string[] | undefined {
  if (!phrases) {
    return undefined;
  }

  if (Array.isArray(phrases)) {
    return phrases;
  }

  const normalizedLocale = normalizeLocaleTag(locale);

  for (const [candidateLocale, list] of Object.entries(
    phrases as Partial<Record<string, readonly string[]>>,
  )) {
    if (Array.isArray(list) && normalizeLocaleTag(candidateLocale) === normalizedLocale) {
      return list;
    }
  }

  return undefined;
}

/**
 * Resolves the phrase list used for generated native artifacts.
 *
 * Falls back through the default locale, `en`, and finally the first declared list so a project
 * that only localizes some fields still generates shortcuts.
 */
export function resolveDefaultPhrases(
  phrases: readonly string[] | Partial<Record<string, readonly string[]>> | undefined,
  defaultLocale: string = DEFAULT_LOCALE,
): readonly string[] {
  if (!phrases) {
    return [];
  }

  if (Array.isArray(phrases)) {
    return phrases;
  }

  return (
    resolvePhrasesForLocale(phrases, defaultLocale) ??
    resolvePhrasesForLocale(phrases, DEFAULT_LOCALE) ??
    Object.values(phrases as Partial<Record<string, readonly string[]>>).find((list) =>
      Array.isArray(list),
    ) ??
    []
  );
}

/**
 * Returns the Android resource directory name for a locale.
 *
 * The project default locale maps to the unqualified `values` directory. Language-only and
 * language+region tags use the compact qualifier Android has always supported; anything richer
 * (a script subtag, for example) uses the BCP 47 `b+` form.
 */
export function toAndroidValuesQualifier(
  locale: string,
  defaultLocale: string = DEFAULT_LOCALE,
): string {
  const normalizedLocale = normalizeLocaleTag(locale);

  if (normalizedLocale === normalizeLocaleTag(defaultLocale)) {
    return "values";
  }

  const subtags = normalizedLocale.split("-");
  const language = subtags[0];

  if (!language) {
    return "values";
  }

  if (subtags.length === 1) {
    return `values-${language}`;
  }

  const region = subtags[1];

  if (subtags.length === 2 && region && REGION_PATTERN.test(region)) {
    return `values-${language}-r${region.toUpperCase()}`;
  }

  return `values-b+${subtags.join("+")}`;
}

/** Returns the Apple `.lproj` directory name for a locale. */
export function toAppleLprojDirectoryName(locale: string): string {
  return `${normalizeLocaleTag(locale)}.lproj`;
}

/** Escapes a string for use as a key or value inside an Apple `.strings` file. */
export function escapeAppleStringsLiteral(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t");
}

/** A single translatable string destined for an Apple `.strings` table. */
export interface AppleStringsEntry {
  /** Lookup key written to the `.strings` file. */
  key: string;
  /** Translated value for the locale being rendered. */
  value: string;
  /** Optional translator comment emitted above the entry. */
  comment?: string;
}

/** Renders an Apple `.strings` file body. */
export function renderAppleStringsFile(entries: readonly AppleStringsEntry[]): string {
  const lines: string[] = [
    "/* Generated by react-native-app-intents. Do not edit manually. */",
    "",
  ];

  for (const entry of entries) {
    if (entry.comment) {
      lines.push(`/* ${entry.comment.replaceAll("*/", "*\\/")} */`);
    }

    lines.push(
      `"${escapeAppleStringsLiteral(entry.key)}" = "${escapeAppleStringsLiteral(entry.value)}";`,
      "",
    );
  }

  return lines.join("\n");
}
