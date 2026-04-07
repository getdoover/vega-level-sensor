from pydoover.tags import Tag, Tags


class VegaLevelSensorTags(Tags):
    # Display values
    last_volume = Tag("number", default=None)
    last_rl = Tag("number", default=None)
    last_raw_distance = Tag("number", default=None)
    last_reliability = Tag("number", default=None)
    time_last_update = Tag("number", default=None)

    # Event tracking
    event_active = Tag("boolean", default=False)
    event_initial_volume = Tag("number", default=None)
    event_started_at = Tag("number", default=None)
    event_volume = Tag("number", default=None)
    start_event_hidden = Tag("boolean", default=False)
    stop_event_hidden = Tag("boolean", default=True)
