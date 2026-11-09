// Management change → who is this person?
//
// SEBI's disclosure rules require a "brief profile" of appointed directors/KMP
// inside the filing itself, so the filing is the first, most reliable source.
// A web search (Tavily) adds the professional background / LinkedIn link when
// a key is configured. The model is told to drop search hits that are not
// clearly the same person, so we don't attach a namesake's CV.

import { llmJson } from "../llm";
import { fetchWithRetry } from "../http";
import type { PersonCard, UsageSummary } from "../types";

interface RawPeople {
  people: { name: string; role: string; change: string; effective?: string; profile?: string }[];
}

export async function extractPeople(text: string, company: string, usage: UsageSummary): Promise<PersonCard[]> {
  const raw = await llmJson<RawPeople>(
    "cheap",
    {
      system: "You extract facts from Indian corporate filings about management changes. Never invent. Output JSON only.",
      prompt: `Company: ${company}
List every person whose role changes in this filing.
Return {"people":[{"name":"","role":"e.g. Chief Financial Officer","change":"appointed|resigned|retired|other","effective":"date if stated","profile":"<=60 words, ONLY from the filing's brief profile / background section, else empty"}]}

--- FILING ---
${text.slice(0, 20000)}`,
      maxOutputTokens: 1500,
    },
    usage,
  );
  return (raw.people || [])
    .filter((p) => p.name)
    .slice(0, 4)
    .map((p) => ({
      name: p.name.trim(),
      role: p.role?.trim() || "",
      change: (["appointed", "resigned", "retired"].includes(p.change) ? p.change : "other") as PersonCard["change"],
      effective: p.effective || undefined,
      bio: p.profile?.trim() || undefined,
      bioSource: p.profile?.trim() ? "filing" : undefined,
    }));
}

interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

export async function enrichPerson(p: PersonCard, company: string, usage: UsageSummary): Promise<PersonCard> {
  const key = process.env.TAVILY_API_KEY;
  if (!key || p.change !== "appointed") return p;
  try {
    const res = await fetchWithRetry("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query: `${p.name} ${p.role} ${company} career background LinkedIn`, max_results: 5, search_depth: "basic" }),
    });
    if (!res.ok) return p;
    const j = (await res.json()) as { results?: TavilyResult[] };
    const hits = (j.results || []).slice(0, 5);
    if (!hits.length) return p;
    const r = await llmJson<{ samePerson: boolean; bio: string; useIdx: number[] }>(
      "cheap",
      {
        system: "You write terse executive bios strictly from the given search snippets. Output JSON only.",
        prompt: `Person: ${p.name}, newly ${p.change} as ${p.role} at ${company}.
${p.bio ? `Filing profile: ${p.bio}\n` : ""}Search results:
${hits.map((h, i) => `[${i}] ${h.title} — ${h.url}\n${h.content.slice(0, 600)}`).join("\n\n")}

Return {"samePerson": true|false, "bio": "max 2 sentences: previous employers/roles, years, education — only facts in the snippets", "useIdx": [indices of results about THIS person]}.
If you are not confident the results describe this exact person, samePerson=false and bio="".`,
        maxOutputTokens: 600,
      },
      usage,
    );
    if (!r.samePerson) return p;
    const links = (r.useIdx || [])
      .map((i) => hits[i])
      .filter(Boolean)
      .sort((a, b) => Number(b.url.includes("linkedin")) - Number(a.url.includes("linkedin")))
      .slice(0, 2)
      .map((h) => ({ title: h.url.includes("linkedin") ? "LinkedIn" : h.title.slice(0, 40), url: h.url }));
    return {
      ...p,
      bio: r.bio || p.bio,
      bioSource: r.bio ? "web" : p.bioSource,
      links,
    };
  } catch {
    return p;
  }
}
