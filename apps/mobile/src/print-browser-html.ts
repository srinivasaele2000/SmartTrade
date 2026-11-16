export function printBrowserHtml(html: string) {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
  frame.title = 'Printable customer document';
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0';
  return new Promise<void>((resolve, reject) => {
    frame.onload = () => {
      const viewer = frame.contentWindow;
      if (!viewer) {
        frame.remove();
        reject(new Error('The printable document could not be opened.'));
        return;
      }
      viewer.addEventListener('afterprint', () => frame.remove(), {once: true});
      try { viewer.print(); resolve(); }
      catch (error) { frame.remove(); reject(error); }
    };
    frame.srcdoc = html;
    document.body.append(frame);
  });
}
