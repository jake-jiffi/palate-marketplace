# The three roles

A site that only its builder can change is a site that stops changing. Most of
what a marketing team wants to do to a website is content, most content changes
are safe, and almost none of them need a developer. What they need is for the
safe ones to be provably safe, so that nobody has to read them.

Three people show up around a live site, and they want different things:

| Role | What they are doing | Repo write | Merges their own work |
|---|---|---|---|
| Technologist | set it up, owns the contract, reviews what routes to them | yes | yes |
| Contributor | writes and edits copy, posts, facts, images | **no** | never |
| Designer | ships whole pages and sections on their own | yes, on a branch | no, structural work is reviewed |

## Contributor

The marketing team. Not developers, and the design does not ask them to become
developers.

**What they can do.** Anything the content runtime covers: write a post, edit a
page's copy, change a business fact once and have every surface follow, swap an
image, schedule a campaign, unpublish something. The commands are
`/palate-website-builder:post`, `:edit`, `:fact`, `:image`, `:campaign`,
`:schedule`, `:publish`, `:unpublish`, `:preview`.

**What they cannot do.** Merge. They hold no write access to the repository at
all. Their change is filed as a pull request they cannot approve, and it merges
either because the router cleared it (content only, every blocking lane green)
or because the technologist read it.

**What they need installed.** Claude Code and the plugin. No MCP token: the
content runtime is free and works with no MCP, degrading rather than dying, so a
contributor never hits a paywall doing their job. If they work through the CMS
path instead (`references/cms-and-draft-preview.md`) they install nothing.

## Technologist

The person the trigger post describes: sets the site up and then ends up
reviewing everything. That is the bottleneck this design exists to remove, and
it removes it by shrinking the queue rather than by speeding up the reading.
Reviewers do not miss things in a batch of fifty changes because they are
careless. They miss things because nobody reads fifty diffs at full depth, and
pretending otherwise produces a rubber stamp with a person's name on it.

**What they can do.** Everything, including the frozen scaffold contract, and
they are the only role that can. They own the routing rules themselves.

**What routes to them**, decided by `scripts/palate-route-review.mjs`:

- any structural or config change,
- any change where a blocking lane failed, or never reported a pass,
- anything touching the frozen contract, green or not.

**What no longer routes to them**: a content change with every blocking lane
green. That branch is the whole labour saving, and everything else in the router
exists to make it safe enough to trust.

**What they need installed.** Claude Code, the plugin, the MCP connected, Node,
a browser for the rendered gate, and repo write and merge rights.

**WHAT IS SHIPPED, AND WHAT IS NOT.** `scripts/palate-route-review.mjs` exists,
is tested, and decides correctly. **Nothing runs it yet.** No CI workflow, no
command and no hook invokes it, and there is no auto-merge step anywhere in the
repo, so today the routing above is a decision the technologist makes with the
script's help rather than one the pipeline makes for them. The contributor path
that files a pull request they cannot approve is likewise designed and not wired.

That gap is deliberate to leave open and dishonest to leave undescribed: the
whole labour saving is content merging without a human, and claiming it before it
is wired would have this file describing a policy the repo does not implement.
Wiring it means a step in `palate-contract.yml` that feeds the router the changed
files plus the lane outcomes and gates a merge on its exit code.

## Designer

Ships a whole landing page solo, end to end, without a developer in the loop for
the building.

**What they can do.** Scaffold and build real pages and sections against the
reference library, run the gates locally, self-heal before anyone sees the work.

**What they still get reviewed on.** Their output is structural by definition, so
it routes to the technologist. That is not a demotion, it is the honest trade:
the designer buys solo velocity through the build, and pays for it with one code
review at the end, instead of a developer sitting in the middle of the work. The
review is also small, because the gates have already run.

**What they need installed.** Claude Code, the plugin, the MCP connected (the
taste lane is the paid half and a design build wants it), Node, and a browser.
Branch write, no merge rights on main.

## The property git normally loses

Separation of duties means the person who makes a change is not the person who
approves it. Version control gives you the mechanism and then hands you a
default that throws it away.

The usual git-backed CMS grants a content editor repository write, because that
is how their edits get committed. Write access is not one permission, it is a
bundle: commit, approve, merge, and in most setups push to the default branch.
So the author of the copy holds the credential that ships the copy. Branch
protection can require a review, but the review requirement is a policy on a
repository, and the person it constrains is an administrator of that repository
in every organisation small enough to be running one site. The separation exists
on paper and evaporates the first time something is urgent on a Friday.

This design keeps the property structurally rather than by policy:

- **The contributor holds no repo write.** Not restricted write, none. There is
  no credential for them to use in a hurry, so author and approver are different
  people by construction rather than by rule.
- **The approver of an auto-merged change is not a person at all.** A content
  change with every blocking lane green merges on a mechanical policy that ran
  the same checks in the same way on every change before it. Nobody approved
  their own work, because nobody approved it.
- **"Not checked" never counts as approval.** Only a lane that ran and passed is
  green. A skipped, errored or absent result holds the change for a human, so
  the day CI breaks is not the day everything merges itself.
- **The frozen contract has no auto path.** The layout, the head and SEO wiring,
  the token source, the route conventions, the CI workflow and the `.palate`
  record always reach a person. An agent that quietly rewrites the layout
  wrapper has already won by the time anything renders: it controls the output
  the rendered gate measures. The diff is the only place that change is visible,
  so a person has to be at the diff.

The frozen list lives in exactly one place, `FROZEN` in
`scripts/palate-route-review.mjs`, with the reason for each entry written beside
it. It is the floor. If the class rules are ever loosened so that some
structural work can merge unread, these still cannot.
