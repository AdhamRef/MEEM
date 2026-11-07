/**
 * Which channels someone's feed draws from. Shared by the browser and the server, so the grid
 * always shows exactly what the feed will do.
 *
 * Only what someone switched by hand is stored. Everything else follows their topics, so a
 * channel added later, or a change of topics, gets the right result with nothing to rewrite.
 */
export type ChannelChoices = Readonly<Record<string, boolean>>;

/** Nobody has chosen anything yet, so nothing is switched off for them. */
export function isOnByDefault(channelTopicIds: readonly string[], selectedTopicIds: ReadonlySet<string>): boolean {
  return selectedTopicIds.size === 0 || channelTopicIds.some((topicId) => selectedTopicIds.has(topicId));
}

export function isChannelOn(channelId: string, channelTopicIds: readonly string[], selectedTopicIds: ReadonlySet<string>, choices: ChannelChoices): boolean {
  return choices[channelId] ?? isOnByDefault(channelTopicIds, selectedTopicIds);
}

/** Records a switch. Back at the default it's forgotten, so the channel follows topics again. */
export function withChannelSwitched(choices: ChannelChoices, channelId: string, isOn: boolean, onByDefault: boolean): Record<string, boolean> {
  const next = { ...choices };
  if (isOn === onByDefault) delete next[channelId];
  else next[channelId] = isOn;
  return next;
}

/** Fills only what the account hasn't decided, so signing in never undoes a choice made there. */
export function mergeChannelChoices(account: ChannelChoices, guest: ChannelChoices, knownChannelIds: ReadonlySet<string>): Record<string, boolean> {
  return Object.fromEntries(Object.entries({ ...guest, ...account }).filter(([channelId]) => knownChannelIds.has(channelId)));
}
