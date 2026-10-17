import { useToast } from '@bohr/ui';
import { useI18n } from 'vue-i18n';
import { ApiError, isAbortError } from '../api';

/**
 * A translated sentence for a failed call. The instance answers in English, so its sentence is only
 * shown as the detail; the project runtime's "not_accepted" message is already in the user's language.
 */
export function useErrorText() {
  const { t } = useI18n();

  return (error: unknown): string => {
    if (!(error instanceof ApiError)) return t('errors.unexpected');
    switch (error.code) {
      case 'network_error':
        return t('errors.network');
      case 'not_accepted':
        return error.message;
      case 'owner_only':
        return t('errors.ownerOnly');
      case 'not_a_member':
        return t('errors.notMember');
      case 'invalid_code':
        return t('errors.invalidCode');
      case 'cannot_revoke_owner':
        return t('errors.cannotRevokeOwner');
      case 'too_large':
        return t('errors.tooLarge');
    }
    if (error.status === 401) return t('errors.signedOut');
    if (error.status === 403) return t('errors.forbidden');
    if (error.status === 404) return t('errors.notFound');
    if (error.status >= 500) return t('errors.server', { detail: error.message });
    return t('errors.withDetail', { detail: error.message });
  };
}

/** Shows a failed call as an error toast; aborted calls are ignored. */
export function useErrorToast() {
  const toast = useToast();
  const errorText = useErrorText();
  return (error: unknown): void => {
    if (isAbortError(error)) return;
    toast.error(errorText(error));
  };
}
