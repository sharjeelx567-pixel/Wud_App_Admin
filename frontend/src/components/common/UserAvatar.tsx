"use client";

import React, { useState, useEffect } from "react";
import { User } from "lucide-react";

interface UserAvatarProps {
  src?: string | null;
  name?: string | null;
  gender?: string | null;
  className?: string;
  iconClassName?: string;
}

export default function UserAvatar({
  src,
  name,
  gender,
  className = "w-10 h-10 rounded-xl",
  iconClassName = "w-4 h-4 text-indigo-600",
}: UserAvatarProps) {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [src]);

  const cleanSrc = (src || "").trim();
  const isLocalPrivateIp =
    cleanSrc.startsWith("http://192.168.") ||
    cleanSrc.startsWith("http://10.") ||
    cleanSrc.startsWith("http://localhost");

  const safeSrc =
    !isLocalPrivateIp && cleanSrc.startsWith("http://")
      ? cleanSrc.replace(/^http:\/\//i, "https://")
      : cleanSrc;

  const isValidUrl =
    !isLocalPrivateIp &&
    safeSrc.length > 0 &&
    (safeSrc.startsWith("https://") || safeSrc.startsWith("data:"));

  if (isValidUrl && !imgError) {
    return (
      <div className={`${className} overflow-hidden bg-slate-100 flex-shrink-0 flex items-center justify-center border border-slate-200`}>
        <img
          src={safeSrc}
          alt={name || "Candidate"}
          // object-top: profile photos are often tall full-body portraits, and
          // a centered cover-crop in a small avatar cuts off the face (shows
          // the torso/lap instead). Anchoring the crop to the top keeps the
          // face visible — matches the app's CachedProfileImage topCenter.
          className="w-full h-full object-cover object-top"
          onError={() => setImgError(true)}
          loading="lazy"
        />
      </div>
    );
  }

  return (
    <div
      className={`${className} overflow-hidden bg-indigo-50 flex-shrink-0 flex items-center justify-center border border-indigo-100`}
      title={name || "Candidate"}
    >
      <User className={iconClassName} />
    </div>
  );
}
