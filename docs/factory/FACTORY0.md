# Factory0

Factory0 is the Paperclip instance at https://factory.t3work.cloud. It is the front door
for this repository: users report issues and suggest features there, and the agent team
picks the work up from that board.

The loop each item travels:

1. **Develop or fix** - an agent works the issue on a branch and opens a pull request into `develop`.
2. **Test** - CI and the review gate run on the pull request before it merges.
3. **Staging** - `develop` deploys to the nightly stack.
4. **Human test** - a human checks the behaviour on staging.
5. **Production** - `develop` merges to `main`, a tag goes out, and the release deploys.
