export function pickBrowserFile(accept: string): Promise<File | undefined> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.hidden = true;
    const finish = () => {
      const file = input.files?.[0];
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', finish, {once: true});
    input.addEventListener('cancel', finish, {once: true});
    document.body.append(input);
    input.click();
  });
}
