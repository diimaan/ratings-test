import { useEffect, useMemo, useState } from 'react';
import { FaArrowDown, FaArrowUp, FaCheck, FaCopy, FaDownload, FaExternalLinkAlt, FaKey, FaSpinner, FaTrash, FaUpload } from 'react-icons/fa';
import { SiStremio } from 'react-icons/si';
import { toast } from 'react-toastify';

const providerDefaults = {
  tmdb: { apiKey: '', apiUrl: 'https://api.themoviedb.org/3' },
  mdblist: { apiKey: '', apiUrl: 'https://api.mdblist.com' },
  publicmetadb: { apiKey: '', apiUrl: 'https://publicmetadb.com' },
};

const safetySourceOptions = [
  {
    value: 'mdblist_conservative',
    label: 'MDBList Conservative',
  },
  {
    value: 'hybrid',
    label: 'Hybrid',
  },
  {
    value: 'direct',
    label: 'Direct',
  },
];

const fallbackRatings = [
  'Common Sense',
  'Parent Safe',
  'Not Safe',
  'Sexual Violence',
  'Sex & Nudity',
  'IMDb (Movie)',
  'IMDb (Show)',
  'IMDb (Episode)',
  'TMDb (Movie)',
  'TMDb (Show)',
  'TMDb (Episode)',
  'MC',
  'RT',
  'PC',
  'Trakt',
  'MAL',
  'Letterboxd',
  'Roger Ebert',
];

function absoluteUrl(path) {
  return new URL(path, window.location.origin).href;
}

function uniqueOrderedRatings(defaults) {
  const order = defaults?.ratings?.order || [];
  const enabled = defaults?.ratings?.enabled || fallbackRatings;
  return [...new Set([...order, ...enabled, ...fallbackRatings])];
}

export function ConfigBuilder({ defaultManifestPath = '/manifest.json' }) {
  const [providers, setProviders] = useState(providerDefaults);
  const [displayMode, setDisplayMode] = useState('auto');
  const [compactLimit, setCompactLimit] = useState(4);
  const [safetySource, setSafetySource] = useState('mdblist_conservative');
  const [enabledRatings, setEnabledRatings] = useState(fallbackRatings);
  const [ratingOrder, setRatingOrder] = useState(fallbackRatings);
  const [manifestUrl, setManifestUrl] = useState(absoluteUrl(defaultManifestPath));
  const [configId, setConfigId] = useState('default');
  const [password, setPassword] = useState('');
  const [retrieveId, setRetrieveId] = useState('');
  const [retrievePassword, setRetrievePassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRetrieving, setIsRetrieving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  useEffect(() => {
    let mounted = true;
    const queryUuid = new URLSearchParams(window.location.search).get('uuid');

    if (queryUuid) {
      setRetrieveId(queryUuid);
    }

    fetch('/api/config/defaults')
      .then((response) => {
        if (!response.ok) throw new Error('Could not load defaults');
        return response.json();
      })
      .then((data) => {
        if (!mounted) return;

        setProviders({
          tmdb: {
            apiKey: '',
            apiUrl: data.providers?.tmdb?.apiUrl || providerDefaults.tmdb.apiUrl,
          },
          mdblist: {
            apiKey: '',
            apiUrl: data.providers?.mdblist?.apiUrl || providerDefaults.mdblist.apiUrl,
          },
          publicmetadb: {
            apiKey: '',
            apiUrl: data.providers?.publicmetadb?.apiUrl || providerDefaults.publicmetadb.apiUrl,
          },
        });
        setDisplayMode(data.ratings?.displayMode || 'auto');
        setCompactLimit(data.ratings?.compactLimit || 4);
        setSafetySource(data.ratings?.safetySource || 'mdblist_conservative');
        setEnabledRatings(data.ratings?.enabled || fallbackRatings);
        setRatingOrder(uniqueOrderedRatings(data));
      })
      .catch((err) => {
        toast.error(err.message);
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const orderedEnabledRatings = useMemo(
    () => ratingOrder.filter((rating) => enabledRatings.includes(rating)),
    [enabledRatings, ratingOrder]
  );

  const canSave = providers.tmdb.apiKey.trim().length > 0 && password.length >= 8;
  const isExistingConfig = configId !== 'default';
  const canInstall = isExistingConfig && manifestUrl.includes('/stremio/');

  const updateProvider = (provider, field, value) => {
    setProviders((current) => ({
      ...current,
      [provider]: {
        ...current[provider],
        [field]: value,
      },
    }));
  };

  const toggleRating = (rating) => {
    setEnabledRatings((current) => {
      if (current.includes(rating)) {
        return current.filter((item) => item !== rating);
      }

      return [...current, rating];
    });
  };

  const moveRating = (rating, direction) => {
    setRatingOrder((current) => {
      const index = current.indexOf(rating);
      if (index === -1) return current;

      const nextIndex = direction === 'up' ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= current.length) return current;

      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const applyConfigResponse = (data, includeSecrets = false) => {
    setConfigId(data.config.id);
    setManifestUrl(data.manifestUrl);

    if (includeSecrets) {
      setProviders({
        tmdb: {
          apiKey: data.config.providers?.tmdb?.apiKey || '',
          apiUrl: data.config.providers?.tmdb?.apiUrl || providerDefaults.tmdb.apiUrl,
        },
        mdblist: {
          apiKey: data.config.providers?.mdblist?.apiKey || '',
          apiUrl: data.config.providers?.mdblist?.apiUrl || providerDefaults.mdblist.apiUrl,
        },
        publicmetadb: {
          apiKey: data.config.providers?.publicmetadb?.apiKey || '',
          apiUrl: data.config.providers?.publicmetadb?.apiUrl || providerDefaults.publicmetadb.apiUrl,
        },
      });
      setDisplayMode(data.config.ratings?.displayMode || 'auto');
      setCompactLimit(data.config.ratings?.compactLimit || 4);
      setSafetySource(data.config.ratings?.safetySource || 'mdblist_conservative');
      setEnabledRatings(data.config.ratings?.enabled || fallbackRatings);
      setRatingOrder(data.config.ratings?.order || fallbackRatings);
    }
  };

  const saveConfig = async () => {
    if (!providers.tmdb.apiKey.trim()) {
      toast.error('TMDb API key is required');
      return;
    }

    if (password.length < 8) {
      toast.error('Config password must be at least 8 characters');
      return;
    }

    setIsSaving(true);

    try {
      const response = await fetch(isExistingConfig ? `/api/config/${encodeURIComponent(configId)}` : '/api/config', {
        method: isExistingConfig ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          password,
          providers: {
            tmdb: {
              apiKey: providers.tmdb.apiKey.trim(),
              apiUrl: providers.tmdb.apiUrl.trim(),
            },
            mdblist: {
              apiKey: providers.mdblist.apiKey.trim(),
              apiUrl: providers.mdblist.apiUrl.trim(),
            },
            publicmetadb: {
              apiKey: providers.publicmetadb.apiKey.trim(),
              apiUrl: providers.publicmetadb.apiUrl.trim(),
            },
          },
          ratings: {
            enabled: orderedEnabledRatings,
            order: ratingOrder,
            displayMode,
            compactLimit,
            safetySource,
          },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Could not create config');
      }

      applyConfigResponse(data);
      toast.success(isExistingConfig ? 'Config updated' : 'Config created');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const retrieveConfig = async () => {
    if (!retrieveId.trim() || !retrievePassword) {
      toast.error('UUID and password are required');
      return;
    }

    setIsRetrieving(true);

    try {
      const response = await fetch(`/api/config/${encodeURIComponent(retrieveId.trim())}/retrieve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          password: retrievePassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Could not retrieve config');
      }

      applyConfigResponse(data, true);
      setPassword(retrievePassword);
      toast.success('Config retrieved');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setIsRetrieving(false);
    }
  };

  const deleteConfig = async () => {
    if (!isExistingConfig) {
      toast.error('Retrieve or create a UUID config first');
      return;
    }

    if (password.length < 8) {
      toast.error('Config password is required');
      return;
    }

    setIsDeleting(true);

    try {
      const response = await fetch(`/api/config/${encodeURIComponent(configId)}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Could not delete config');
      }

      setConfigId('default');
      setManifestUrl(absoluteUrl(defaultManifestPath));
      setPassword('');
      toast.success('Config deleted');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setIsDeleting(false);
    }
  };

  const changePassword = async () => {
    if (!isExistingConfig) {
      toast.error('Retrieve or create a UUID config first');
      return;
    }

    if (password.length < 8 || newPassword.length < 8) {
      toast.error('Current and new passwords must be at least 8 characters');
      return;
    }

    setIsChangingPassword(true);

    try {
      const response = await fetch(`/api/config/${encodeURIComponent(configId)}/password`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentPassword: password,
          newPassword,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Could not change password');
      }

      setPassword(newPassword);
      setRetrievePassword(newPassword);
      setNewPassword('');
      toast.success('Config password changed');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setIsChangingPassword(false);
    }
  };

  const copyManifest = () => {
    if (!canInstall) {
      toast.error('Create or retrieve a UUID config first');
      return;
    }

    navigator.clipboard.writeText(manifestUrl)
      .then(() => toast.success('Manifest URL copied'))
      .catch(() => toast.error('Could not copy manifest URL'));
  };

  const openStremioWeb = () => {
    if (!canInstall) {
      toast.error('Create or retrieve a UUID config first');
      return;
    }

    window.open(`https://web.stremio.com/#/addons?addon=${encodeURIComponent(manifestUrl)}`, '_blank');
  };

  const openStremioApp = () => {
    if (!canInstall) {
      toast.error('Create or retrieve a UUID config first');
      return;
    }

    window.location.href = manifestUrl.replace(/^https?:\/\//i, 'stremio://');
  };

  const backupPayload = (includeCredentials) => ({
    type: 'ratings-aggregator-config',
    version: 1,
    exportedAt: new Date().toISOString(),
    config: {
      id: configId === 'default' ? null : configId,
      providers: {
        tmdb: {
          apiKey: includeCredentials ? providers.tmdb.apiKey : '',
          apiUrl: providers.tmdb.apiUrl,
        },
        mdblist: {
          apiKey: includeCredentials ? providers.mdblist.apiKey : '',
          apiUrl: providers.mdblist.apiUrl,
        },
        publicmetadb: {
          apiKey: includeCredentials ? providers.publicmetadb.apiKey : '',
          apiUrl: providers.publicmetadb.apiUrl,
        },
      },
      ratings: {
        enabled: orderedEnabledRatings,
        order: ratingOrder,
        displayMode,
        compactLimit,
        safetySource,
      },
    },
  });

  const exportConfig = (includeCredentials) => {
    const payload = backupPayload(includeCredentials);
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ratings-config-${configId === 'default' ? 'draft' : configId}${includeCredentials ? '-with-credentials' : ''}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(includeCredentials ? 'Config backup exported with credentials' : 'Config backup exported without credentials');
  };

  const importConfig = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) return;

    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const imported = payload.config || payload;

      setProviders({
        tmdb: {
          apiKey: imported.providers?.tmdb?.apiKey || '',
          apiUrl: imported.providers?.tmdb?.apiUrl || providerDefaults.tmdb.apiUrl,
        },
        mdblist: {
          apiKey: imported.providers?.mdblist?.apiKey || '',
          apiUrl: imported.providers?.mdblist?.apiUrl || providerDefaults.mdblist.apiUrl,
        },
        publicmetadb: {
          apiKey: imported.providers?.publicmetadb?.apiKey || '',
          apiUrl: imported.providers?.publicmetadb?.apiUrl || providerDefaults.publicmetadb.apiUrl,
        },
      });
      setDisplayMode(imported.ratings?.displayMode || 'auto');
      setCompactLimit(imported.ratings?.compactLimit || 4);
      setSafetySource(imported.ratings?.safetySource || 'mdblist_conservative');
      setEnabledRatings(imported.ratings?.enabled || fallbackRatings);
      setRatingOrder(imported.ratings?.order || fallbackRatings);
      toast.success('Config backup imported');
    } catch (err) {
      toast.error(`Could not import config: ${err.message}`);
    }
  };

  return (
    <section className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
      <div className="card-gradient rounded-lg p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-300">
            <FaKey />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Configure Addon</h2>
            <p className="text-sm text-gray-400">Create a private UUID manifest without putting API keys in the URL.</p>
          </div>
        </div>

        <div className="grid gap-5">
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-gray-200">TMDb API key</span>
            <input
              type="password"
              value={providers.tmdb.apiKey}
              onChange={(event) => updateProvider('tmdb', 'apiKey', event.target.value)}
              className="rounded-lg border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none focus:border-emerald-400"
              placeholder="Required"
              autoComplete="off"
            />
            <span className="text-xs text-gray-400">Validated on save. Required for TMDb ratings and reliable title mapping.</span>
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-semibold text-gray-200">Config password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="rounded-lg border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none focus:border-emerald-400"
              placeholder="Required for retrieving or updating this UUID"
              autoComplete="new-password"
            />
            <span className="text-xs text-amber-200">Keep this with the UUID. There is no password recovery for saved configs.</span>
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-gray-200">MDBList API key</span>
              <input
                type="password"
                value={providers.mdblist.apiKey}
                onChange={(event) => updateProvider('mdblist', 'apiKey', event.target.value)}
                className="rounded-lg border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none focus:border-emerald-400"
                placeholder="Recommended"
                autoComplete="off"
              />
              <span className="text-xs text-amber-200">Recommended for better rating and warning accuracy.</span>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-semibold text-gray-200">Public MetaDB key</span>
              <input
                type="password"
                value={providers.publicmetadb.apiKey}
                onChange={(event) => updateProvider('publicmetadb', 'apiKey', event.target.value)}
                className="rounded-lg border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none focus:border-emerald-400"
                placeholder="Optional fallback"
                autoComplete="off"
              />
              <span className="text-xs text-gray-400">Experimental fallback when MDBList is unavailable or empty.</span>
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-[1fr_160px]">
            <div>
              <span className="mb-2 block text-sm font-semibold text-gray-200">Display mode</span>
              <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-white/10">
                {['auto', 'compact', 'full'].map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setDisplayMode(mode)}
                    className={`px-4 py-3 text-sm font-semibold capitalize ${displayMode === mode ? 'bg-emerald-500 text-slate-950' : 'bg-slate-950 text-gray-300'}`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            <label className="grid gap-2">
              <span className="text-sm font-semibold text-gray-200">Compact limit</span>
              <input
                type="number"
                min="1"
                max="12"
                value={compactLimit}
                onChange={(event) => setCompactLimit(Number(event.target.value))}
                className="rounded-lg border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none focus:border-emerald-400"
              />
            </label>
          </div>

          <div>
            <span className="mb-2 block text-sm font-semibold text-gray-200">Safety source</span>
            <div className="grid overflow-hidden rounded-lg border border-white/10 md:grid-cols-3">
              {safetySourceOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setSafetySource(option.value)}
                  className={`px-4 py-3 text-sm font-semibold ${safetySource === option.value ? 'bg-emerald-500 text-slate-950' : 'bg-slate-950 text-gray-300'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <span className="mt-2 block text-xs text-gray-400">
              Hybrid tests direct Common Sense/Cringe results first and falls back to MDBList-derived safety when direct data is unavailable.
            </span>
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-gray-200">Ratings to show</span>
              <span className="text-xs text-gray-400">{orderedEnabledRatings.length} enabled</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {ratingOrder.map((rating, index) => {
                const selected = enabledRatings.includes(rating);
                return (
                  <div
                    key={rating}
                    className={`grid min-h-11 grid-cols-[1fr_auto] items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${selected ? 'border-emerald-400 bg-emerald-400/10 text-white' : 'border-white/10 bg-slate-950 text-gray-400'}`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleRating(rating)}
                      className="flex items-center justify-between gap-2 text-left"
                    >
                      <span>{rating}</span>
                      {selected && <FaCheck className="shrink-0 text-emerald-300" />}
                    </button>
                    <span className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => moveRating(rating, 'up')}
                        disabled={index === 0}
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 text-gray-300 disabled:opacity-30"
                        title={`Move ${rating} up`}
                      >
                        <FaArrowUp />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveRating(rating, 'down')}
                        disabled={index === ratingOrder.length - 1}
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 text-gray-300 disabled:opacity-30"
                        title={`Move ${rating} down`}
                      >
                        <FaArrowDown />
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={saveConfig}
            disabled={isSaving || isLoading || !canSave}
            className="button-gradient flex min-h-12 items-center justify-center gap-2 rounded-lg px-5 py-3 font-bold disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? <FaSpinner className="animate-spin" /> : <FaCheck />}
            {isExistingConfig ? 'Save Config' : 'Create UUID Manifest'}
          </button>
        </div>
      </div>

      <aside className="card-gradient rounded-lg p-6">
        <h2 className="mb-2 text-2xl font-bold">Install</h2>
        <p className="mb-5 text-sm text-gray-400">Current config: <span className="font-mono text-gray-200">{configId}</span></p>

        <div className="mb-5 rounded-lg border border-white/10 bg-slate-950 p-3">
          <p className="break-all font-mono text-xs text-emerald-200">
            {canInstall ? manifestUrl : 'Create or retrieve a UUID config to unlock the install manifest.'}
          </p>
        </div>

        <div className="grid gap-3">
          <button
            onClick={copyManifest}
            disabled={!canInstall}
            className="button-gradient flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-3 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FaCopy /> Copy URL
          </button>
          <button
            onClick={openStremioWeb}
            disabled={!canInstall}
            className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/10 bg-slate-950 px-4 py-3 font-semibold text-white hover:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FaExternalLinkAlt /> Stremio Web
          </button>
          <button
            onClick={openStremioApp}
            disabled={!canInstall}
            className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/10 bg-slate-950 px-4 py-3 font-semibold text-white hover:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <SiStremio /> Open Stremio
          </button>
        </div>

        <div className="mt-6 rounded-lg border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100">
          This is BYOB-only. API keys are stored server-side against your UUID config, and the install URL only contains the UUID.
        </div>

        <div className="mt-6 border-t border-white/10 pt-6">
          <h3 className="mb-3 text-lg font-bold">Retrieve Config</h3>
          <div className="grid gap-3">
            <input
              type="text"
              value={retrieveId}
              onChange={(event) => setRetrieveId(event.target.value)}
              className="rounded-lg border border-white/10 bg-slate-950 px-4 py-3 font-mono text-sm text-white outline-none focus:border-emerald-400"
              placeholder="UUID"
              autoComplete="off"
            />
            <input
              type="password"
              value={retrievePassword}
              onChange={(event) => setRetrievePassword(event.target.value)}
              className="rounded-lg border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none focus:border-emerald-400"
              placeholder="Password"
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={retrieveConfig}
              disabled={isRetrieving || !retrieveId.trim() || !retrievePassword}
              className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/10 bg-slate-950 px-4 py-3 font-semibold text-white hover:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isRetrieving ? <FaSpinner className="animate-spin" /> : <FaKey />}
              Retrieve
            </button>
          </div>
        </div>

        <div className="mt-6 border-t border-white/10 pt-6">
          <h3 className="mb-3 text-lg font-bold">Backup</h3>
          <div className="grid gap-3">
            <button
              type="button"
              onClick={() => exportConfig(false)}
              className="button-gradient flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-3 font-semibold text-white"
            >
              <FaDownload /> Export Safe JSON
            </button>
            <button
              type="button"
              onClick={() => exportConfig(true)}
              className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-amber-300/30 bg-slate-950 px-4 py-3 font-semibold text-amber-100 hover:border-amber-200"
            >
              <FaDownload /> Export With Keys
            </button>
            <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-white/10 bg-slate-950 px-4 py-3 font-semibold text-white hover:border-emerald-400">
              <FaUpload /> Import JSON
              <input type="file" accept="application/json" onChange={importConfig} className="hidden" />
            </label>
          </div>
        </div>

        <div className="mt-6 border-t border-white/10 pt-6">
          <h3 className="mb-3 text-lg font-bold">Password</h3>
          <div className="grid gap-3">
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className="rounded-lg border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none focus:border-emerald-400"
              placeholder="New password"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={changePassword}
              disabled={!isExistingConfig || isChangingPassword}
              className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/10 bg-slate-950 px-4 py-3 font-semibold text-white hover:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isChangingPassword ? <FaSpinner className="animate-spin" /> : <FaKey />}
              Change Password
            </button>
          </div>
        </div>

        <div className="mt-6 border-t border-white/10 pt-6">
          <button
            type="button"
            onClick={deleteConfig}
            disabled={!isExistingConfig || isDeleting}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-red-300/30 bg-red-500/10 px-4 py-3 font-semibold text-red-100 hover:border-red-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isDeleting ? <FaSpinner className="animate-spin" /> : <FaTrash />}
            Delete Config
          </button>
        </div>
      </aside>
    </section>
  );
}
