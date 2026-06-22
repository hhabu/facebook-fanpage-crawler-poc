import type { ProductSnapshot } from "../lib/scraperTypes";
import type { RenderedPage } from "../browser/browserEngine";

function clean(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractTitle(html: string): string {
  return (
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "Unknown product")
  );
}

function extractPrice(text: string): { price: number | null; currency: string | null } {
  const match = text.match(/(₫|VND|\$|USD|EUR|€)\s*([0-9][0-9.,]*)|([0-9][0-9.,]*)\s*(₫|VND|\$|USD|EUR|€)/i);
  if (!match) {
    return { price: null, currency: null };
  }

  const currency = match[1] ?? match[4] ?? null;
  const rawPrice = match[2] ?? match[3] ?? "";
  const price = Number(rawPrice.replace(/[.,](?=\d{3}\b)/g, "").replace(",", "."));

  return { price: Number.isFinite(price) ? price : null, currency };
}

function extractAvailability(text: string): string {
  if (/out of stock|sold out|unavailable|hết hàng/i.test(text)) {
    return "out_of_stock";
  }

  if (/in stock|available|còn hàng|add to cart|buy now/i.test(text)) {
    return "in_stock";
  }

  return "unknown";
}

function extractJsonLdProduct(html: string): Partial<ProductSnapshot> {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script[1].trim());
      const candidates = Array.isArray(parsed) ? parsed : [parsed, ...(parsed["@graph"] ?? [])];
      const product = candidates.find((item) => item?.["@type"] === "Product" || item?.["@type"]?.includes?.("Product"));
      if (product) {
        const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
        return {
          productName: product.name,
          price: offer?.price ? Number(offer.price) : null,
          currency: offer?.priceCurrency ?? null,
          availability: offer?.availability ?? null,
          imageUrl: Array.isArray(product.image) ? product.image[0] : product.image ?? null
        };
      }
    } catch {
      // Ignore malformed JSON-LD and continue with heuristic extraction.
    }
  }

  return {};
}

export function extractProductFromRendered(rendered: RenderedPage): ProductSnapshot {
  const html = rendered.rawHtml;
  const text = rendered.rawText || clean(html);
  const { price, currency } = extractPrice(text);
  const jsonLd = extractJsonLdProduct(html);

  return {
    productName: jsonLd.productName || extractTitle(html),
    price: jsonLd.price ?? price,
    currency: jsonLd.currency ?? currency,
    availability: jsonLd.availability ?? extractAvailability(text),
    imageUrl: jsonLd.imageUrl ?? html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? null
  };
}

export async function scrapeProduct(sourceUrl: string): Promise<ProductSnapshot> {
  const response = await fetch(sourceUrl, { headers: { "user-agent": "MultiBotMVP/0.1" } });
  const html = await response.text();
  return extractProductFromRendered({
    url: sourceUrl,
    title: null,
    rawHtml: html,
    rawText: clean(html),
    screenshotPath: null,
    httpStatus: response.status,
    engine: "fetch"
  });
}
