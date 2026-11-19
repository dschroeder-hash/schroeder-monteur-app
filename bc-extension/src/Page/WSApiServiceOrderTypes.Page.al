/// <summary>
/// Service Order Types (read-only).
/// </summary>
page 50104 "WS API Service Order Types"
{
    PageType = API;
    APIPublisher = 'schroeder';
    APIGroup = 'werkstatt';
    APIVersion = 'v1.0';
    EntityName = 'serviceOrderType';
    EntitySetName = 'serviceOrderTypes';
    EntityCaption = 'serviceOrderType';
    EntitySetCaption = 'serviceOrderTypes';
    SourceTable = "Service Order Type";
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
