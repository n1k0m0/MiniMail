export function handleMessageRowKeydown(event, uid, select, openContextMenu) {
  if (event.target !== event.currentTarget) return;
  if (event.key === "Enter") select(uid);
  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
    openContextMenu(event, uid);
}
