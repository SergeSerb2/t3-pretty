import type { EnvironmentId, ProjectIconColor, ProjectIconOverride } from "@t3tools/contracts";
import {
  getProjectFaviconResourceKey,
  isProjectFaviconFallbackUrl,
} from "@t3tools/shared/projectFavicon";
import {
  BotIcon,
  BookOpenIcon,
  BracesIcon,
  CircuitBoardIcon,
  CloudCogIcon,
  Code2Icon,
  DatabaseIcon,
  FlaskConicalIcon,
  FolderCodeIcon,
  Gamepad2Icon,
  Globe2Icon,
  ImageIcon,
  Layers3Icon,
  MonitorIcon,
  MusicIcon,
  PackageIcon,
  ServerIcon,
  ShieldCheckIcon,
  ShoppingBagIcon,
  SmartphoneIcon,
  TerminalIcon,
  VideoIcon,
} from "lucide-react";
import type { IconName } from "lucide-react/dynamic";
import type { ComponentType } from "react";
import { lazy, Suspense, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { projectFaviconUrlAtom } from "../state/assets";
import { selectProjectIcon, type ProjectIconName } from "../projectIconModel";
import { projectIconColorClassName } from "../projectIconColors";
import { cn } from "~/lib/utils";

const loadedProjectFaviconSrcs = new Map<string, string>();
const MAX_LOADED_PROJECT_FAVICONS = 256;

function readLoadedProjectFavicon(cacheKey: string): string | null {
  const src = loadedProjectFaviconSrcs.get(cacheKey) ?? null;
  if (src !== null) {
    loadedProjectFaviconSrcs.delete(cacheKey);
    loadedProjectFaviconSrcs.set(cacheKey, src);
  }
  return src;
}

function rememberLoadedProjectFavicon(cacheKey: string, src: string): void {
  loadedProjectFaviconSrcs.delete(cacheKey);
  loadedProjectFaviconSrcs.set(cacheKey, src);
  while (loadedProjectFaviconSrcs.size > MAX_LOADED_PROJECT_FAVICONS) {
    const oldestKey = loadedProjectFaviconSrcs.keys().next().value;
    if (oldestKey === undefined) break;
    loadedProjectFaviconSrcs.delete(oldestKey);
  }
}

  );
  const isLoading = displayedSrc !== src;
  const handleLoadError = (failedSrc: string) => {
    setDisplayedSrc((currentSrc) => (currentSrc === failedSrc ? null : currentSrc));
  };

  return (
    <>
      {displayedSrc === null ? (
        <ProjectFaviconFallback
          className={className}
          colorClassName={fallbackColorClassName}
          icon={FallbackIcon}
          emoji={fallbackEmoji}
        />
      ) : null}
      {displayedSrc ? (
        <img
          src={displayedSrc}
          alt=""
          className={cn("size-3.5 shrink-0 rounded-sm object-contain", className)}
          onError={() => handleLoadError(displayedSrc)}
        />
      ) : null}
      {isLoading ? (
        <img
          src={src}
          alt=""
          className="hidden"
          onLoad={() => {
<<<<<<< HEAD
            rememberLoadedProjectFavicon(cacheKey, src);
=======
>>>>>>> v0.0.39-nightly.20260907.1332
            setDisplayedSrc(src);
          }}
          onError={() => handleLoadError(src)}
        />
      ) : null}
    </>
  );
}
