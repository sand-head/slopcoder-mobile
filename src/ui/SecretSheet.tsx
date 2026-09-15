/**
 * The one readable copy of a webhook secret.
 *
 * A write that mints one — creating a routine with a webhook trigger, or
 * rotating the secret an existing one has — answers with it exactly once;
 * the row keeps only the hash. So the sheet is modal in the real sense: it
 * shows the URL, offers the platform's share sheet (which is where Copy
 * lives on both platforms, beside every other place a URL can go), and only
 * then continues wherever the save was headed.
 */
import React from 'react';
import { Platform, Share, View } from 'react-native';
import type { AutomationWebhookSecret } from '../api/contracts';
import { hookUrl, shortId } from '../api/routineEditor';
import { Button, Hint, Meta, Mono } from './kit';
import { Sheet } from './Sheet';
import { useTheme } from '../theme';

export function SecretSheet({
  secrets,
  server,
  onContinue,
}: {
  /** Empty means nothing to show, and the sheet stays down. */
  secrets: AutomationWebhookSecret[];
  /** The origin the user reaches slopcoder on; the URL is assembled here. */
  server: string | undefined;
  onContinue: () => void;
}) {
  const { c } = useTheme();

  return (
    <Sheet visible={secrets.length > 0} title="Copy this now" onClose={onContinue}>
      <Hint>The secret is stored hashed and can never be shown again.</Hint>
      {secrets.map(hook => {
        const url = server ? hookUrl(server, hook.automationId, hook.triggerId, hook.secret) : hook.secret;
        return (
          <View key={hook.triggerId} style={{ gap: 8 }}>
            <Meta>webhook {shortId(hook.triggerId)}</Meta>
            <Mono selectable style={{ color: c.foreground }}>
              {url}
            </Mono>
            <Button
              label="Share the URL"
              variant="outline"
              onPress={() => void Share.share(Platform.OS === 'ios' ? { url } : { message: url })}
            />
          </View>
        );
      })}
      <Hint>
        Send the secret as the X-Slopcoder-Hook header when you can; the ?secret= in the URL is for callers
        that cannot set one, and puts the secret in their logs.
      </Hint>
      <Button label="Continue" onPress={onContinue} />
    </Sheet>
  );
}
