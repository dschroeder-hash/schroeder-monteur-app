/// <summary>
/// Causes of Absence (read-only).
/// </summary>
page 50106 "WS API Causes of Absence"
{
    PageType = API;
    APIPublisher = 'schroeder';
    APIGroup = 'werkstatt';
    APIVersion = 'v1.0';
    EntityName = 'causeOfAbsence';
    EntitySetName = 'causesOfAbsence';
    EntityCaption = 'causeOfAbsence';
    EntitySetCaption = 'causesOfAbsence';
    SourceTable = "Cause of Absence";
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
