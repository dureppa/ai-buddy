import { Fragment, type ReactNode } from 'react';
import { Icon } from './ui';

type Reference = { title: string; url: string };

function safeUrl(url: string): boolean {
  if (!/^(https?:\/\/|\/(?!\/))/.test(url) || /[\s\\]/.test(url)) return false;
  try {
    const parsed = new URL(url, 'https://buddy.invalid');
    return !parsed.username && !parsed.password && (parsed.protocol === 'https:' || parsed.protocol === 'http:');
  } catch {
    return false;
  }
}

export function cleanAnswer(text: string, references: Reference[]): string {
  const paths = new Set<string>();
  const ids = new Set<string>();
  for (const reference of references) {
    if (!safeUrl(reference.url)) continue;
    const url = new URL(reference.url, 'https://buddy.invalid');
    paths.add(url.pathname);
    const article = url.searchParams.get('article');
    if (article) ids.add(article);
  }
  return text
    .split(/(```[\s\S]*?```)/)
    .map((part) => {
      if (part.startsWith('```')) return part;
      let result = part;
      if (paths.has('/onboarding')) result = result.replace(/\(\s*id\s*[:=]?\s*[`'"]([a-z][a-z0-9-]*)[`'"]\s*\)/g, '');
      return result
        .split(/(`[^`\n]+`)/)
        .map((token) => {
          if (token.startsWith('`')) return token;
          return token
            .replace(/\[([a-zA-Z0-9_.:-]+)\](?!\()/g, (original, id: string) => {
              const group = id.split(':')[0];
              return ids.has(id) ||
                (group === 'team' && paths.has('/team')) ||
                ((group === 'onboarding' || group === 'task') && paths.has('/onboarding'))
                ? ''
                : original;
            })
            .replace(/[ \t]+([,.;!?])/g, '$1')
            .replace(/[ \t]{2,}/g, ' ')
            .replace(/([^\n]) +([*]{2}[^*\n]{2,80}:[*]{2})/g, '$1\n\n$2');
        })
        .join('');
    })
    .join('');
}

function inline(text: string, references: Reference[]): ReactNode[] {
  const tokens = text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\([^\s)]+\))/g);
  return tokens.map((token, index) => {
    if (token.startsWith('**') && token.endsWith('**')) return <strong key={index}>{token.slice(2, -2)}</strong>;
    if (token.startsWith('`') && token.endsWith('`')) return <code key={index}>{token.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
    if (link)
      return safeUrl(link[2]) && references.some((reference) => reference.url === link[2]) ? (
        <a key={index} href={link[2]} target="_blank" rel="noopener noreferrer">
          {link[1]}
        </a>
      ) : (
        <span key={index}>{link[1]}</span>
      );
    return token;
  });
}

export function AgentAnswer({ text, references = [] }: { text: string; references?: Reference[] }) {
  const unique = references.filter(
    (reference, index) => safeUrl(reference.url) && references.findIndex((r) => r.url === reference.url) === index,
  );
  const lines = cleanAnswer(text, unique).split('\n');
  const blocks: ReactNode[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }
    if (line.startsWith('```')) {
      const code: string[] = [];
      index++;
      while (index < lines.length && !lines[index].startsWith('```')) code.push(lines[index++]);
      index++;
      blocks.push(
        <pre key={blocks.length}>
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      blocks.push(
        <p key={blocks.length} className="agent-answer__heading">
          <strong>{inline(line.replace(/^#{1,6}\s+/, ''), unique)}</strong>
        </p>,
      );
      index++;
      continue;
    }
    const list = /^\s*(?:([-*])\s+|(\d+)[.)]\s+)/.exec(line);
    if (list) {
      const ordered = !list[1];
      const items: ReactNode[] = [];
      const pattern = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/;
      while (index < lines.length && pattern.test(lines[index]))
        items.push(<li key={items.length}>{inline(lines[index++].replace(pattern, ''), unique)}</li>);
      blocks.push(
        ordered ? (
          <ol key={blocks.length} start={list[2] === '1' ? undefined : Number(list[2])}>
            {items}
          </ol>
        ) : (
          <ul key={blocks.length}>{items}</ul>
        ),
      );
      continue;
    }
    const paragraph: ReactNode[] = [];
    do {
      if (paragraph.length) paragraph.push(<br key={'break-' + index} />);
      paragraph.push(<Fragment key={'line-' + index}>{inline(lines[index++], unique)}</Fragment>);
    } while (
      index < lines.length &&
      lines[index].trim() &&
      !/^\s*(?:[-*]\s+|\d+[.)]\s+|#{1,6}\s|```)/.test(lines[index])
    );
    blocks.push(<p key={blocks.length}>{paragraph}</p>);
  }
  return (
    <div className="agent-answer">
      <div className="agent-answer__text">{blocks}</div>
      {unique.length > 0 && (
        <div className="agent-sources" aria-label="Источники ответа">
          {unique.map((reference) => (
            <a
              className="agent-source"
              key={reference.url}
              href={reference.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="file" size={16} />
              <span>{reference.title}</span>
              <Icon name="diagonal" size={14} />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
