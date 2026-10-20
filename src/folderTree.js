export function buildFolderTree(folders) {
  const roots = [];
  const nodes = new Map();

  for (const folder of folders) {
    const delimiter = folder.delimiter || "/";
    const parts = folder.path.split(delimiter);
    let siblings = roots;
    for (let index = 0; index < parts.length; index++) {
      const path = parts.slice(0, index + 1).join(delimiter);
      let node = nodes.get(path);
      if (!node) {
        node = { path, name: parts[index], folder: null, children: [] };
        nodes.set(path, node);
        siblings.push(node);
      }
      if (index === parts.length - 1) {
        node.folder = folder;
        node.name = folder.name || parts[index];
      }
      siblings = node.children;
    }
  }

  function sort(nodes, root = false) {
    const priority = (node) => {
      if (!root) return 5;
      const special = node.folder?.specialUse;
      if (node.path.toUpperCase() === "INBOX") return 0;
      return (
        { "\\Drafts": 1, "\\Sent": 2, "\\Archive": 3, "\\Trash": 4 }[special] ??
        5
      );
    };
    nodes.sort(
      (a, b) => priority(a) - priority(b) || a.name.localeCompare(b.name, "de"),
    );
    nodes.forEach((node) => sort(node.children));
  }
  sort(roots, true);
  return roots;
}

export function visibleFolderNodes(tree, collapsed, filter = "") {
  const term = filter.trim().toLocaleLowerCase();
  const result = [];
  function visit(node, depth) {
    const childMatches = term
      ? node.children.some((child) => matches(child))
      : false;
    if (term && !node.path.toLocaleLowerCase().includes(term) && !childMatches)
      return;
    result.push({ node, depth });
    if (!collapsed.has(node.path) || term) {
      node.children.forEach((child) => visit(child, depth + 1));
    }
  }
  function matches(node) {
    return (
      node.path.toLocaleLowerCase().includes(term) ||
      node.children.some(matches)
    );
  }
  tree.forEach((node) => visit(node, 0));
  return result;
}
