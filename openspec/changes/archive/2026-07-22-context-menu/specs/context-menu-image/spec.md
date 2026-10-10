## ADDED Requirements

### Requirement: Image properties in context menu

The system SHALL display an "Image properties" item when the user right-clicks on an image.

#### Scenario: Open image properties

- **WHEN** user right-clicks on an image and clicks "Image properties" in the context menu
- **THEN** the image properties dialog is opened (alt text, border settings)

### Requirement: Image wrap options in context menu

The system SHALL display wrap type options when the user right-clicks on an image.

#### Scenario: Change wrap type to inline

- **WHEN** user right-clicks on an image and selects "Inline" wrap option
- **THEN** the image wrap type is changed to inline

#### Scenario: Change wrap type to wrap text

- **WHEN** user right-clicks on an image and selects "Wrap text" option
- **THEN** the image wrap type is changed to floating with text wrapping

### Requirement: Alt text shortcut in context menu

The system SHALL display an "Alt text" item when the user right-clicks on an image.

#### Scenario: Edit alt text

- **WHEN** user right-clicks on an image and clicks "Alt text" in the context menu
- **THEN** the alt text editing flow is triggered for that image

### Requirement: Image items only shown on images

The system SHALL only show image-specific context menu items when an image is right-clicked.

#### Scenario: No image items on text

- **WHEN** user right-clicks on plain text (not an image)
- **THEN** no image-specific items appear in the context menu
