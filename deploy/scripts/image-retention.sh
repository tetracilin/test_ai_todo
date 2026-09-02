#!/usr/bin/env bash
# usage: image-retention.sh <image-name> <tag-prefix> [keep-count=2]
# Deletes old Docker images, keeping only the N most recent ones.
# Example: image-retention.sh paperclip nightly 2  # keeps current + 1 rollback
set -euo pipefail

image_name="$1"
tag_prefix="$2"
keep="${3:-2}"

# List all tags for this image, sorted by creation time (newest first)
tags=$(docker images --format "table {{.Repository}}:{{.Tag}}\t{{.CreatedAt}}" \
  | grep "^${image_name}:${tag_prefix}" \
  | sort -k2 -r \
  | awk '{print $1}')

tag_count=$(echo "$tags" | grep -c . || true)

if [[ $tag_count -le $keep ]]; then
  echo "retention: $tag_count images, keeping all (threshold is $keep)"
  exit 0
fi

to_delete=$(echo "$tags" | tail -n +$((keep + 1)))
echo "retention: $tag_count images total, deleting $((tag_count - keep)) old images:"
echo "$to_delete" | while read -r tag; do
  echo "  deleting $tag"
  docker rmi "$tag" || echo "  (failed to delete $tag; may be in use)"
done
