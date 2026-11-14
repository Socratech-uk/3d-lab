/** Keep keyboard navigation inside an open modal, including Chromium's chrome boundary. */
export function containDialogFocus(dialog) {
  const keydown = event => {
    if(event.key!=='Tab' || event.defaultPrevented || !dialog.open)return;
    const controls=[...dialog.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')]
      .filter(node=>!node.disabled&&node.tabIndex>=0&&node.getClientRects().length);
    if(!controls.length){event.preventDefault();dialog.focus();return;}
    const first=controls[0],last=controls.at(-1),active=document.activeElement;
    if(event.shiftKey&&(active===first||!controls.includes(active))){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&(active===last||!controls.includes(active))){event.preventDefault();first.focus();}
  };
  dialog.addEventListener('keydown',keydown);
  return ()=>dialog.removeEventListener('keydown',keydown);
}
