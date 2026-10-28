export function attachmentFile(attachment) {
  const bytes = Uint8Array.from(atob(attachment.data), (char) =>
    char.charCodeAt(0),
  );
  return new File([bytes], attachment.name);
}

export async function encodeAttachments(files) {
  return Promise.all(
    files.map(async (file) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 8192)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      return { name: file.name, data: btoa(binary) };
    }),
  );
}
