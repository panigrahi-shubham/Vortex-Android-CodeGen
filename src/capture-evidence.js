// Read the hierarchy before taking the image: a slow tree lookup must not
// return a screenshot taken several seconds before that lookup completed.
export async function captureEvidence(device, settledRaw) {
  const [raw,activity]=await Promise.all([
    settledRaw??device.tree(),
    device.activity?device.activity().catch(()=>null):null,
  ]);
  return {raw,activity,shot:await device.screenshot(),capturedAt:new Date().toISOString()};
}
