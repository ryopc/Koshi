import React from 'react';
import { useNavigate } from 'react-router-dom';

const ago = (iso) => {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export default function PostCard({ post }) {
  const navigate = useNavigate();

  return (
    <div className="post">
      <div className="post-header">
        <span
          className="post-author"
          onClick={(e) => {
            e.stopPropagation();
            if (post.author?.username) navigate(`/profile/${post.author.username}`);
          }}
        >
          @{post.author?.username || 'anonymous'}
        </span>
        <span className="post-time">{ago(post.createdAt || post.timestamp)}</span>
      </div>
      <div className="post-content">{post.content}</div>
      <div className="post-footer">
        <span className="post-signature">✓ signed</span>
        {post.signature && (
          <span className="post-sig">sig:{post.signature.slice(0, 8)}...</span>
        )}
      </div>
    </div>
  );
}
