import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { useMemo } from "react";
import type { EffectiveServiceTree, ServiceTreeNode } from "../types";

export function ServiceTreeSelector({ tree, selected, expanded, search, onSearch, onSelectedChange, onExpandedChange }: {
  tree: EffectiveServiceTree;
  selected: string[];
  expanded: string[];
  search: string;
  onSearch: (value: string) => void;
  onSelectedChange: (value: string[]) => void;
  onExpandedChange: (value: string[]) => void;
}) {
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const includedBy = useMemo(() => {
    const result = new Map<string, string>();
    const queue = [...selected];
    while (queue.length) {
      const source = queue.shift()!;
      for (const relation of tree.relations.filter((item) => item.sourceSlug === source && ["includes", "included_when_selected"].includes(item.relationType))) {
        if (!result.has(relation.targetSlug)) { result.set(relation.targetSlug, source); queue.push(relation.targetSlug); }
      }
    }
    return result;
  }, [selected, selectedSet, tree.relations]);
  const query = normalize(search);
  const visibleRoots = useMemo(() => tree.roots.filter((node) => matchesTree(node, query)), [tree.roots, query]);

  function toggleNode(node: ServiceTreeNode) {
    if (includedBy.has(node.slug)) return;
    if (selectedSet.has(node.slug)) return onSelectedChange(selected.filter((slug) => slug !== node.slug));
    const excluded = tree.relations.filter((item) => item.sourceSlug === node.slug && ["excludes", "alternative_to"].includes(item.relationType)).map((item) => item.targetSlug);
    const reverseExcluded = tree.relations.filter((item) => item.targetSlug === node.slug && ["excludes", "alternative_to"].includes(item.relationType)).map((item) => item.sourceSlug);
    const withoutConflicts = selected.filter((slug) => !excluded.includes(slug) && !reverseExcluded.includes(slug));
    const includedTargets = tree.relations.filter((item) => item.sourceSlug === node.slug && ["includes", "included_when_selected"].includes(item.relationType)).map((item) => item.targetSlug);
    onSelectedChange([...withoutConflicts.filter((slug) => !includedTargets.includes(slug)), node.slug]);
  }

  return <div className="service-tree-selector">
    <label className="service-tree-search"><Search size={18} />Найти задачу<input value={search} placeholder="Название или описание" onChange={(event) => onSearch(event.target.value)} /></label>
    <div className="service-tree-roots">{visibleRoots.map((node) => <TreeNode key={node.slug} node={node} depth={0} tree={tree} selectedSet={selectedSet} includedBy={includedBy} expanded={expanded} query={query} onToggle={toggleNode} onExpand={(slug) => onExpandedChange(expanded.includes(slug) ? expanded.filter((item) => item !== slug) : [...expanded, slug])} />)}</div>
    {visibleRoots.length === 0 && <p className="empty-state">По вашему запросу задачи не найдены.</p>}
  </div>;
}

function TreeNode({ node, depth, tree, selectedSet, includedBy, expanded, query, onToggle, onExpand }: {
  node: ServiceTreeNode; depth: number; tree: EffectiveServiceTree; selectedSet: Set<string>; includedBy: Map<string, string>; expanded: string[]; query: string;
  onToggle: (node: ServiceTreeNode) => void; onExpand: (slug: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const open = expanded.includes(node.slug) || Boolean(query) || depth === 0;
  const includedSource = includedBy.get(node.slug);
  const requirement = tree.relations.find((item) => item.sourceSlug === node.slug && item.relationType === "requires" && !selectedSet.has(item.targetSlug) && !includedBy.has(item.targetSlug));
  const suggested = selectedSet.has(node.slug) ? tree.relations.filter((item) => item.sourceSlug === node.slug && item.relationType === "suggests") : [];
  const includedChildren = selectedSet.has(node.slug) ? tree.relations.filter((item) => item.sourceSlug === node.slug && ["includes", "included_when_selected"].includes(item.relationType)) : [];
  const bySlug = new Map(tree.flatNodes.map((item) => [item.slug, item]));
  return <div className={`service-tree-node service-tree-node--depth-${Math.min(depth, 6)}${selectedSet.has(node.slug) ? " is-selected" : ""}${includedSource ? " is-included" : ""}`} style={{ "--tree-depth": depth } as React.CSSProperties}>
    <div className="service-tree-node__row">
      {hasChildren ? <button type="button" className="icon-button" title={open ? "Свернуть" : "Раскрыть"} onClick={() => onExpand(node.slug)}>{open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</button> : <span className="service-tree-node__spacer" />}
      {node.isSelectable && !includedSource ? <input type="checkbox" checked={selectedSet.has(node.slug)} disabled={Boolean(requirement)} onChange={() => onToggle(node)} aria-label={node.title} /> : null}
      <button type="button" className="service-tree-node__title" onClick={() => hasChildren ? onExpand(node.slug) : node.isSelectable && !requirement ? onToggle(node) : undefined}><strong>{node.title}</strong>{node.description && <small>{node.description}</small>}</button>
      {includedSource && <span className="status-badge">Входит</span>}
      {requirement && <span className="status-badge muted">Обязательно вместе с «{bySlug.get(requirement.targetSlug)?.title}»</span>}
    </div>
    {includedChildren.length > 0 && <div className="service-tree-included"><strong>Входит в выбранную задачу</strong>{includedChildren.map((relation) => <span key={relation.targetSlug}>{bySlug.get(relation.targetSlug)?.title ?? relation.targetSlug}</span>)}</div>}
    {suggested.length > 0 && <div className="service-tree-suggestions"><strong>Также часто требуется</strong>{suggested.filter((item) => !selectedSet.has(item.targetSlug)).map((relation) => { const target = bySlug.get(relation.targetSlug); return target ? <button type="button" className="secondary-button" key={target.slug} onClick={() => onToggle(target)}>Добавить: {target.title}</button> : null; })}</div>}
    {open && hasChildren && <div className="service-tree-node__children">{node.children.filter((child) => !includedBy.has(child.slug) || includedBy.get(child.slug) === node.slug).filter((child) => matchesTree(child, query)).map((child) => <TreeNode key={child.slug} node={child} depth={depth + 1} tree={tree} selectedSet={selectedSet} includedBy={includedBy} expanded={expanded} query={query} onToggle={onToggle} onExpand={onExpand} />)}</div>}
  </div>;
}

function matchesTree(node: ServiceTreeNode, query: string): boolean { return !query || normalize(`${node.title} ${node.description ?? ""} ${node.aliases.join(" ")}`).includes(query) || node.children.some((child) => matchesTree(child, query)); }
function normalize(value: string) { return value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").trim(); }
