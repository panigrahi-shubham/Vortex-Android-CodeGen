// The device command has already succeeded when this is called. Observation
// failure must never turn it into an apparently unexecuted action.
export async function observeCompletedAction(observe, invalidate) {
  try {
    return { ...(await observe()), actionCompleted: true };
  } catch (error) {
    invalidate();
    return { actionCompleted: true, screen: null, suggestions: [], screenChange: null,
      warning: `Action completed, but the screen could not be read: ${error.message}. Refresh before continuing; do not repeat the action.` };
  }
}
