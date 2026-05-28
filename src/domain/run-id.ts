import { asRunId, asRunSlug, type RunId, type RunSlug } from "./run.js";

const CROCKFORD_BASE32_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

export const ADJECTIVES = [
  "able",
  "active",
  "adventurous",
  "alert",
  "amazing",
  "amber",
  "amiable",
  "ancient",
  "apt",
  "arctic",
  "artful",
  "ash",
  "austere",
  "autumn",
  "awake",
  "balanced",
  "bashful",
  "beaming",
  "brave",
  "breezy",
  "bright",
  "brisk",
  "calm",
  "capable",
  "careful",
  "cheerful",
  "clever",
  "cloudy",
  "cozy",
  "crisp",
  "curious",
  "dapper",
  "daring",
  "dawn",
  "deft",
  "delightful",
  "dependable",
  "dreamy",
  "eager",
  "early",
  "earnest",
  "easy",
  "electric",
  "elegant",
  "emerald",
  "fair",
  "fancy",
  "fast",
  "festive",
  "fine",
  "fleet",
  "fluffy",
  "focused",
  "fresh",
  "friendly",
  "frosty",
  "gentle",
  "giddy",
  "glad",
  "gleaming",
  "golden",
  "graceful",
  "grand",
  "green",
  "happy",
  "hardy",
  "helpful",
  "honest",
  "hopeful",
  "humble",
  "icy",
  "ideal",
  "jolly",
  "joyful",
  "keen",
  "kind",
  "lively",
  "loyal",
  "lucky",
  "lunar",
  "mellow",
  "merry",
  "mighty",
  "minty",
  "modest",
  "nimble",
  "noble",
  "novel",
  "opal",
  "orderly",
  "patient",
  "peppy",
  "plucky",
  "polite",
  "proud",
  "quick",
  "quiet",
  "radiant",
  "rapid",
  "ready",
  "regal",
  "robust",
  "rosy",
  "round",
  "royal",
  "safe",
  "sandy",
  "shiny",
  "silver",
  "simple",
  "smart",
  "snappy",
  "snowy",
  "solar",
  "solid",
  "speedy",
  "spry",
  "steady",
  "sunny",
  "swift",
  "tidy",
  "true",
  "trusty",
  "upbeat",
  "valiant",
  "velvet",
  "vivid",
  "warm",
  "wavy",
  "wise",
  "witty",
  "zesty",
  "agile",
  "airy",
  "blissful",
  "bold",
  "bonny",
  "bouncy",
  "bubbly",
  "chipper",
  "classic",
  "clear",
  "comfy",
  "cool",
  "crafty",
  "dazzling",
  "dear",
  "deep",
  "diligent",
  "eastern",
  "even",
  "fabled",
  "faithful",
  "gentlemanly",
  "gifted",
  "glossy",
  "happyhearted",
  "hearty",
  "honey",
  "jovial",
  "leafy",
  "light",
  "little",
  "lucid",
  "misty",
  "neat",
  "nifty",
  "peaceful",
  "playful",
  "pleasant",
  "prime",
  "prompt",
  "pure",
  "right",
  "safehearted",
  "scarlet",
  "serene",
  "sharp",
  "silky",
  "smooth",
  "soft",
  "sound",
  "sparkly",
  "stout",
  "sweet",
  "thoughtful",
  "tiny",
  "vibrant",
  "welcoming",
  "whole",
  "winsome",
  "young",
] as const;

export const ANIMALS = [
  "aardvark",
  "alpaca",
  "antelope",
  "ape",
  "badger",
  "bat",
  "beaver",
  "bee",
  "beetle",
  "bison",
  "bobcat",
  "buffalo",
  "butterfly",
  "camel",
  "canary",
  "capybara",
  "caribou",
  "cat",
  "chamois",
  "cheetah",
  "chicken",
  "chipmunk",
  "cobra",
  "condor",
  "cougar",
  "cow",
  "crab",
  "crane",
  "crow",
  "deer",
  "dingo",
  "dolphin",
  "donkey",
  "dove",
  "duck",
  "eagle",
  "egret",
  "elephant",
  "elk",
  "falcon",
  "ferret",
  "finch",
  "fish",
  "flamingo",
  "fox",
  "frog",
  "gazelle",
  "gecko",
  "gerbil",
  "giraffe",
  "goat",
  "goose",
  "gorilla",
  "hamster",
  "hare",
  "hawk",
  "hedgehog",
  "heron",
  "horse",
  "hummingbird",
  "ibex",
  "iguana",
  "impala",
  "jaguar",
  "kangaroo",
  "koala",
  "lemur",
  "leopard",
  "lion",
  "lizard",
  "llama",
  "lynx",
  "macaw",
  "magpie",
  "manatee",
  "meerkat",
  "mink",
  "mole",
  "monkey",
  "moose",
  "mouse",
  "newt",
  "ocelot",
  "otter",
  "owl",
  "panda",
  "panther",
  "parrot",
  "peacock",
  "pelican",
  "penguin",
  "pony",
  "porpoise",
  "possum",
  "puma",
  "quail",
  "rabbit",
  "raven",
  "reindeer",
  "rhino",
  "robin",
  "salamander",
  "seal",
  "sheep",
  "skink",
  "sloth",
  "sparrow",
  "squid",
  "squirrel",
  "stork",
  "swan",
  "tapir",
  "tiger",
  "toad",
  "toucan",
  "turtle",
  "vicuna",
  "walrus",
  "wombat",
  "yak",
  "zebra",
  "addax",
  "akita",
  "angelfish",
  "armadillo",
  "avocet",
  "barracuda",
  "bass",
  "budgie",
  "bunting",
  "burro",
  "cardinal",
  "carp",
  "cassowary",
  "catfish",
  "chinchilla",
  "cicada",
  "cod",
  "coot",
  "cormorant",
  "coyote",
  "dachshund",
  "damselfly",
  "dragonfly",
  "emu",
  "firefly",
  "gannet",
  "gibbon",
  "goldfinch",
  "goldfish",
  "greyhound",
  "grouse",
  "guanaco",
  "guppy",
  "harrier",
  "hoopoe",
  "jay",
  "kestrel",
  "kiwi",
  "kudu",
  "ladybug",
  "lapwing",
  "lorikeet",
  "marmot",
  "marten",
  "mastiff",
  "mayfly",
  "minnow",
  "myna",
  "nightingale",
  "oriole",
  "oryx",
  "osprey",
  "parakeet",
  "pheasant",
  "pika",
  "poodle",
  "puffin",
  "quokka",
  "raccoon",
  "redbird",
  "salmon",
  "seahorse",
  "sheltie",
  "shrimp",
  "skylark",
  "snail",
  "starling",
  "stoat",
  "sunbird",
  "tamarin",
  "tetra",
  "thrush",
  "trout",
  "wallaby",
  "weasel",
  "whippet",
  "wren",
] as const;

export type ParseIdentifierResult =
  | { kind: "id"; match: RunId }
  | { kind: "slug"; match: RunId }
  | { kind: "ambiguous"; candidates: RunId[] }
  | { kind: "not-found" };

export function generateRunId(rand: () => string = defaultRunIdSeed): RunId {
  return asRunId(base32Encode(seedBytes(rand())).slice(0, 8));
}

export function generateSlug(rand: () => number = Math.random): RunSlug {
  const adjective = ADJECTIVES[pickIndex(rand, ADJECTIVES.length)];
  const animal = ANIMALS[pickIndex(rand, ANIMALS.length)];
  return asRunSlug(`${adjective}-${animal}`);
}

export function parseIdentifier(
  input: string,
  candidates: Array<{ id: RunId; slug: RunSlug }>,
): ParseIdentifierResult {
  if (input.length === 0) return { kind: "not-found" };
  const normalized = input.toLowerCase();
  const matches = candidates.flatMap((candidate) => {
    const idMatches = candidate.id.toLowerCase().startsWith(normalized);
    const slugMatches = candidate.slug.toLowerCase().startsWith(normalized);

    if (!idMatches && !slugMatches) {
      return [];
    }

    return [
      {
        id: candidate.id,
        kind: idMatches ? ("id" as const) : ("slug" as const),
      },
    ];
  });

  const uniqueIds = [...new Set(matches.map((match) => match.id))];
  if (uniqueIds.length === 0) {
    return { kind: "not-found" };
  }
  if (uniqueIds.length > 1) {
    return { kind: "ambiguous", candidates: uniqueIds };
  }

  const match = matches.find((candidate) => candidate.id === uniqueIds[0]);
  return { kind: match?.kind ?? "id", match: uniqueIds[0] };
}

function defaultRunIdSeed(): string {
  return globalThis.crypto.randomUUID();
}

function seedBytes(seed: string): Uint8Array {
  const hex = seed.replaceAll("-", "").toLowerCase();
  if (/^[0-9a-f]{16,}/.test(hex)) {
    const bytes = new Uint8Array(8);
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }

  const bytes = new TextEncoder().encode(seed);
  return bytes.length > 0 ? bytes : new Uint8Array([0]);
}

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += CROCKFORD_BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += CROCKFORD_BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output.padEnd(8, "0");
}

function pickIndex(rand: () => number, length: number): number {
  const value = rand();
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.min(Math.floor(value * length), length - 1);
}
