# Specification Quality Checklist: Reactome's pathway PDFs from the graph

**Purpose**: Validate specification completeness and quality before proceeding to planning

**Created**: 2026-10-29

**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- **Named constraints:** the container image and CI are named in FR-009 and FR-010 as
  constraints the release and the project already set, not as design choices. How the
  graph is read, how figures are drawn and how the PDF is laid out are left to the plan.
- **No clarification markers:** the open questions in #3, and the decisions the first
  review raised, have defaults under Assumptions:
  - the book's scope, name and place;
  - the switch from the release's file-list check;
  - the analysis service as the overlay's source;
  - the website's part in WebsiteAngular.
- **The background was checked against `event-pdf`'s source** (its main class,
  exporter, sections and verifier) and the content service's controller, after the
  first review (#4) found it wrong in places.
- **Departures from today** are listed under the spec's Assumptions, as the differences
  the comparison expects.
- **After the second review (#5):**
  - the licence rule covers what the exporter ships, not Reactome's content;
  - the analysis result is read where the analysis service writes it, as today;
  - the section order and the subpathway figure are as `event-pdf` writes them;
  - the faults the check looks for are defined.
- **After the third review (#7):** the endpoint's token answers are a departure from today
  (today answers an empty response). The contents list's own entry comes last. The
  overlay's defaults and the analysis values are stated more fully.
- **The look (User Story 6, FR-015, FR-016, SC-009),** added at the user's request: the
  PDFs take the website's theme colours and typefaces and a plain, modern layout. Today's
  book "looks a little like it is made with 20 year old tech".
- **After the fourth review (#8):**
  - the theme's colours cover the PDFs' own text and layout; figures, illustrations,
    overlays and the logo keep their own (SC-008), so SC-009 and SC-008 can both pass;
  - the theme is a dependency, followed when this repository updates it;
  - the typefaces are named (Roboto, Roboto Mono, a fallback), the light theme chosen,
    and the theme package's undeclared licence recorded;
  - FR-016's layout rules are checkable; running headers and page numbers are left out
    of FR-012's comparison;
  - the token departure sits under the endpoint's answers, and the token states map onto
    Story 2's cases;
  - FR-015, FR-016 and SC-009 follow FR-014 and SC-008.
- **After the fifth review (#9):** the book's one cover is defined (FR-002) and compared
  by its names (FR-012); every PDF has bookmarks and, where it has a contents list, puts
  it first; FR-011's missing-figure fault applies only where the figure's source
  exists; the fallback typeface is named; front pages' running headers are defined;
  dropped analysis options are ignored.
