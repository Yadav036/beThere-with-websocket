import { useToast } from "@/hooks/use-toast";

export interface ShareEventData {
  eventId: string;
  eventName: string;
  eventLocation: string;
  eventDate: string;
}

/**
 * Share an event using the native Web Share API with fallback
 * @param eventData Event data to share
 * @returns Promise<boolean> - true if shared successfully
 */
export async function shareEvent(eventData: ShareEventData): Promise<boolean> {
  const shareUrl = `${window.location.origin}/event/${eventData.eventId}`;
  const shareTitle = `Join "${eventData.eventName}" on BeThere!`;
  const shareText = `I've invited you to ${eventData.eventName} at ${eventData.eventLocation} on ${eventData.eventDate}. Join me with real-time location sharing!`;

  const shareData = {
    title: shareTitle,
    text: shareText,
    url: shareUrl,
  };

  // Try native Web Share API first
  if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
    try {
      await navigator.share(shareData);
      return true;
    } catch (error) {
      // User cancelled or share failed
      console.log('Native share cancelled or failed:', error);
      return false;
    }
  }

  // Fallback to clipboard copy
  try {
    await navigator.clipboard.writeText(`${shareText}\n\n${shareUrl}`);
    return true;
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    return false;
  }
}

/**
 * Copy event link to clipboard
 * @param eventId Event ID
 * @returns Promise<boolean> - true if copied successfully
 */
export async function copyEventLink(eventId: string): Promise<boolean> {
  const url = `${window.location.origin}/join/${eventId}`;
  
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch (error) {
    console.error('Failed to copy link:', error);
    
    // Fallback for older browsers
    const textArea = document.createElement('textarea');
    textArea.value = url;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();
    
    try {
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      return successful;
    } catch (fallbackError) {
      document.body.removeChild(textArea);
      return false;
    }
  }
}

/**
 * Hook for sharing functionality with toast notifications
 */
export function useEventShare() {
  const { toast } = useToast();

  const handleShare = async (eventData: ShareEventData) => {
    const shared = await shareEvent(eventData);
    
    if (shared) {
      toast({
        title: "📤 Event Shared!",
        description: "Invite link has been shared or copied to clipboard",
        variant: "default"
      });
    } else {
      toast({
        title: "❌ Share Failed",
        description: "Unable to share event. Please try again.",
        variant: "destructive"
      });
    }
  };

  const handleCopyLink = async (eventId: string) => {
    const copied = await copyEventLink(eventId);
    
    if (copied) {
      toast({
        title: "📋 Link Copied!",
        description: "Event link has been copied to clipboard",
        variant: "default"
      });
    } else {
      toast({
        title: "❌ Copy Failed",
        description: "Unable to copy link. Please try again.",
        variant: "destructive"
      });
    }
  };

  return {
    shareEvent: handleShare,
    copyEventLink: handleCopyLink
  };
}
