import { useEffect } from 'react';

interface SeoProps {
  title?: string;
  description?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  canonical?: string;
  jsonLd?: Record<string, unknown>;
}

/**
 * Dynamically update <head> meta tags for SEO.
 * Call from any page to set page-specific title / description / JSON-LD.
 */
export function useSeo(props: SeoProps) {
  useEffect(() => {
    const previousTitle = document.title;

    if (props.title) {
      document.title = `${props.title} — 墨韵`;
    }

    // Helper: update or create a <meta> tag
    const setMeta = (name: string, content: string, property = false) => {
      const attr = property ? 'property' : 'name';
      let el = document.querySelector(`meta[${attr}="${name}"]`);
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, name);
        document.head.appendChild(el);
      }
      el.setAttribute('content', content);
    };

    if (props.description) {
      setMeta('description', props.description);
      setMeta('og:description', props.description, true);
    }
    if (props.ogTitle) setMeta('og:title', props.ogTitle, true);
    if (props.ogImage) setMeta('og:image', props.ogImage, true);
    if (props.canonical) {
      let el = document.querySelector('link[rel="canonical"]');
      if (!el) {
        el = document.createElement('link');
        el.setAttribute('rel', 'canonical');
        document.head.appendChild(el);
      }
      el.setAttribute('href', props.canonical);
    }

    // JSON-LD structured data
    let scriptEl: HTMLScriptElement | null = null;
    if (props.jsonLd) {
      scriptEl = document.createElement('script');
      scriptEl.type = 'application/ld+json';
      scriptEl.textContent = JSON.stringify(props.jsonLd);
      scriptEl.setAttribute('data-seo', 'jsonld');
      document.head.appendChild(scriptEl);
    }

    return () => {
      document.title = previousTitle;
      // Only remove the script we injected
      document.querySelectorAll('script[data-seo="jsonld"]').forEach(el => el.remove());
    };
  }, [props.title, props.description, props.ogTitle, props.ogDescription, props.ogImage, props.canonical, props.jsonLd]);
}
