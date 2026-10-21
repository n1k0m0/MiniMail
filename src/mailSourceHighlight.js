const MAX_HIGHLIGHT_TOKENS = 12000;
const HEADER_VALUE_PATTERN =
  /"(?:\\.|[^"\\])*"|<[^<>]+>|\b(?:boundary|charset|filename|name)(?==)/gi;
const HTML_PATTERN =
  /<\/?[A-Za-z][^>]*>|&(?:#\d+|#x[0-9a-f]+|[A-Za-z][A-Za-z0-9]+);/gi;
const QUOTED_PRINTABLE_PATTERN = /(?:=[0-9a-f]{2})+/gi;

export function highlightMailSource(source) {
  const tokens = [];
  const boundaries = new Set();
  let inHeaders = true;
  let headerName = "";
  let headerValue = "";
  let contentType = "";
  let transferEncoding = "";

  function add(text, type = "plain") {
    if (!text) return;
    const previous = tokens.at(-1);
    if (previous?.type === type) previous.text += text;
    else tokens.push({ text, type });
  }

  function addMatches(text, pattern, typeForMatch) {
    pattern.lastIndex = 0;
    let position = 0;
    for (const match of text.matchAll(pattern)) {
      add(text.slice(position, match.index));
      add(match[0], typeForMatch(match[0]));
      position = match.index + match[0].length;
    }
    add(text.slice(position));
  }

  function finishHeader() {
    if (headerName === "content-type") {
      contentType = headerValue.split(";", 1)[0].trim().toLowerCase();
      const boundary = headerValue.match(
        /\bboundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i,
      );
      if (boundary) boundaries.add(boundary[1] || boundary[2]);
    } else if (headerName === "content-transfer-encoding") {
      transferEncoding = headerValue.trim().toLowerCase();
    }
    headerName = "";
    headerValue = "";
  }

  const lines = /[^\r\n]*(?:\r\n|\n|\r|$)/g;
  for (const match of source.matchAll(lines)) {
    if (!match[0]) break;
    if (tokens.length >= MAX_HIGHLIGHT_TOKENS) {
      add(source.slice(match.index));
      break;
    }

    const line = match[0];
    const ending = line.match(/(?:\r\n|\n|\r)$/)?.[0] || "";
    const text = ending ? line.slice(0, -ending.length) : line;
    const boundary = [...boundaries].find(
      (value) => text === `--${value}` || text === `--${value}--`,
    );

    if (boundary) {
      finishHeader();
      add(text, "boundary");
      inHeaders = text !== `--${boundary}--`;
      contentType = "";
      transferEncoding = "";
      if (!inHeaders) boundaries.delete(boundary);
    } else if (inHeaders && text === "") {
      finishHeader();
      inHeaders = false;
    } else if (inHeaders && /^[ \t]/.test(text) && headerName) {
      headerValue += ` ${text.trim()}`;
      addMatches(text, HEADER_VALUE_PATTERN, (value) =>
        /^(?:boundary|charset|filename|name)$/i.test(value)
          ? "parameter"
          : "string",
      );
    } else if (inHeaders) {
      finishHeader();
      const header = text.match(/^([!-9;-~]+)(:)(.*)$/);
      if (header) {
        headerName = header[1].toLowerCase();
        headerValue = header[3];
        add(header[1], "header");
        add(header[2], "punctuation");
        addMatches(header[3], HEADER_VALUE_PATTERN, (value) =>
          /^(?:boundary|charset|filename|name)$/i.test(value)
            ? "parameter"
            : "string",
        );
      } else {
        add(text);
      }
    } else if (transferEncoding === "base64") {
      add(text, "encoded");
    } else if (contentType === "text/html") {
      addMatches(text, HTML_PATTERN, () => "markup");
    } else if (transferEncoding === "quoted-printable") {
      addMatches(text, QUOTED_PRINTABLE_PATTERN, () => "encoded");
    } else {
      add(text);
    }
    add(ending);
  }
  return tokens;
}
