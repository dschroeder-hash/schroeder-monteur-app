/// <summary>
/// Work Types (read-only).
/// </summary>
page 50107 "WS API Work Types"
{
    PageType = API;
    APIPublisher = 'schroeder';
    APIGroup = 'werkstatt';
    APIVersion = 'v1.0';
    EntityName = 'workType';
    EntitySetName = 'workTypes';
    EntityCaption = 'workType';
    EntitySetCaption = 'workTypes';
    SourceTable = "Work Type";
    ODataKeyFields = SystemId;
    Editable = false;
    InsertAllowed = false;
    ModifyAllowed = false;
    DeleteAllowed = false;
    Extensible = false;

    layout
    {
        area(Content)
        {
            repeater(Records)
            {
                field(id; Rec.SystemId) { }
                field("code"; Rec.Code) { }
                field(description; Rec.Description) { }
                field(lastModifiedDateTime; Rec.SystemModifiedAt) { }
            }
        }
    }
}
