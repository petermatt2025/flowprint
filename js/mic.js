document.getElementById("allow").onclick = async () => {
  const st = document.getElementById("st");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    st.textContent = "✓ Microphone allowed. You can close this tab.";
    st.className = "status ok";
  } catch (e) {
    st.textContent = `✗ ${e.message}. Check Chrome's site settings for this extension.`;
    st.className = "status err";
  }
};
